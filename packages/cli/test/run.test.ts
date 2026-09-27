/**
 * `run` and `benchmark` end to end against a real Git repository in a
 * temporary directory. Git is real; Docker, the app and the judge are fakes.
 * The fake Docker remembers which side's containers are up, so the fake app
 * can answer differently for baseline and candidate.
 */

import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { EXIT_CODE, type ResultsFile, type RunResult, runResultSchema } from "@contextforge/shared";
import { beforeEach, describe, expect, it } from "vitest";

import { runCommand } from "../src/commands/run.js";
import { type Exec, exec as realExec } from "../src/util/exec.js";
import { silentLogger } from "./helpers.js";

const GIT_ENV = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.com",
  GIT_CONFIG_NOSYSTEM: "1",
};

let repo = "";

async function git(...args: string[]): Promise<string> {
  const result = await realExec("git", args, { cwd: repo, env: GIT_ENV });
  if (result.code !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

async function write(file: string, content: string): Promise<void> {
  await writeFile(path.join(repo, file), content);
}

const CONFIG = (judge = "gpt-4o-mini") => `
version: 1
app: { compose_file: compose.yml, service: rag-app, startup_timeout: 10 }
dataset: { path: testcases.json }
evaluation:
  metrics: [faithfulness]
  judge: { provider: openai, model: ${judge}, api_key_env: null }
baseline: { mode: cached, store: benchmark/baseline }
thresholds: { mean_drop: { faithfulness: 0.05 } }
report: {}
`;

const DATASET = JSON.stringify({
  dataset_version: 1,
  generated_at: "2026-09-27T00:00:00Z",
  generator: { tool: "handwritten", version: "n/a", model: "n/a" },
  cases: ["a", "b", "c"].map((id) => ({
    id,
    question: `question ${id}?`,
    ground_truth: "truth",
    reference_context_ids: [],
    hops: "single",
  })),
});

/** Fake Docker. Scores come from the answer text, which says which side produced it. */
function fakeDocker(scores: { baseline: number; candidate: number }) {
  let upRole = "none";
  const log: string[] = [];

  const exec: Exec = async (command, args, options) => {
    if (command === "git") return realExec(command, args, options);

    const joined = args.join(" ");
    if (args[0] === "info" || args[0] === "image") return { code: 0, stdout: "29.0", stderr: "" };

    if (args[0] === "compose") {
      const project = args[args.indexOf("--project-name") + 1] ?? "";
      const sub = args[5];
      if (sub === "up") {
        upRole = project.includes("baseline") ? "baseline" : "candidate";
        log.push(`up ${upRole}`);
      }
      if (sub === "down")
        log.push(`down ${project.includes("baseline") ? "baseline" : "candidate"}`);
      return { code: 0, stdout: sub === "ps" ? "container-id" : "", stderr: "" };
    }

    if (args[0] === "run" && joined.includes(" score ")) {
      log.push("score");
      const workdir = (args[args.indexOf("--volume") + 1] ?? "").split(":")[0] ?? "";
      const request = JSON.parse(await readFile(path.join(workdir, "request.json"), "utf8")) as {
        judge: { model: string };
        cases: { case_id: string; answer: string }[];
      };
      await writeFile(
        path.join(workdir, "response.json"),
        JSON.stringify({
          evaluator: {
            ragas_version: "0.4.3",
            judge_model: request.judge.model,
            embeddings_model: null,
          },
          results: request.cases.map((c) => ({
            case_id: c.case_id,
            scores: {
              faithfulness: c.answer.startsWith("baseline") ? scores.baseline : scores.candidate,
            },
            errors: {},
          })),
        }),
      );
      return { code: 0, stdout: "", stderr: "" };
    }
    return { code: 1, stdout: "", stderr: `unexpected docker ${joined}` };
  };

  const fetchImpl: typeof fetch = (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const body = url.endsWith("/health")
      ? { status: "ok" }
      : { answer: `${upRole} answer`, contexts: [{ text: "ctx", id: "doc.md#c1" }] };
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  };

  return { exec, fetch: fetchImpl, log };
}

beforeEach(async () => {
  repo = await mkdtemp(path.join(tmpdir(), "contextforge-repo-"));
  await git("init", "--quiet", "--initial-branch=main");
  await write("contextforge.yml", CONFIG());
  await write("compose.yml", "services:\n  rag-app:\n    image: sample\n");
  await write("testcases.json", DATASET);
  await git("add", ".");
  await git("commit", "--quiet", "-m", "base");
});

async function feature(): Promise<void> {
  await git("switch", "--quiet", "--create", "feature");
  await write("app.txt", "a change under test");
  await git("add", ".");
  await git("commit", "--quiet", "-m", "change");
}

function runOptions(
  docker: ReturnType<typeof fakeDocker>,
  extra: Partial<Parameters<typeof runCommand>[0]> = {},
) {
  return {
    configPath: path.join(repo, "contextforge.yml"),
    candidate: "HEAD",
    baseBranch: "main",
    outputDir: path.join(repo, ".contextforge"),
    answersOnly: false,
    exec: docker.exec,
    fetch: docker.fetch,
    logger: silentLogger,
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
    user: null,
    ...extra,
  };
}

async function written(name: string): Promise<RunResult> {
  return runResultSchema.parse(
    JSON.parse(await readFile(path.join(repo, ".contextforge", name), "utf8")),
  );
}

async function results(): Promise<ResultsFile> {
  return JSON.parse(
    await readFile(path.join(repo, ".contextforge", "results.json"), "utf8"),
  ) as ResultsFile;
}

describe("run", () => {
  it("dual: a regression exits 1 and names the metric", async () => {
    await feature();
    const docker = fakeDocker({ baseline: 0.9, candidate: 0.5 });

    const outcome = await runCommand(runOptions(docker, { mode: "dual" }));

    expect(outcome.exitCode).toBe(EXIT_CODE.regression);
    const file = await results();
    expect(file.verdict.status).toBe("fail");
    expect(file.verdict.metrics[0]).toMatchObject({ name: "faithfulness", status: "fail" });
    expect(file.verdict.regressed_cases).toEqual(["a", "b", "c"]);
  });

  it("dual: builds and scores both sides and writes their results", async () => {
    await feature();
    const docker = fakeDocker({ baseline: 0.9, candidate: 0.8 });

    const outcome = await runCommand(runOptions(docker, { mode: "dual" }));

    expect(outcome.mode).toBe("dual");
    expect(docker.log).toEqual([
      "up candidate",
      "down candidate",
      "up baseline",
      "down baseline",
      "score",
      "score",
    ]);
    expect((await written("baseline.json")).summary.faithfulness).toBeCloseTo(0.9, 10);
    expect((await written("candidate.json")).summary.faithfulness).toBeCloseTo(0.8, 10);
  });

  it("answers-only needs no judge and writes both sides' answers", async () => {
    await feature();
    const docker = fakeDocker({ baseline: 0, candidate: 0 });

    const outcome = await runCommand(runOptions(docker, { answersOnly: true }));

    expect(outcome.mode).toBe("answers-only");
    expect(docker.log).not.toContain("score");
    const baseline = runResultSchema.parse(
      JSON.parse(await readFile(path.join(repo, ".contextforge", "baseline.json"), "utf8")),
    );
    expect(baseline.results[0]?.answer).toBe("baseline answer");
    expect(existsSync(path.join(repo, ".contextforge", "results.json"))).toBe(false);
  });

  it("marks a dirty candidate in its commit label and the notes", async () => {
    await feature();
    await write("app.txt", "uncommitted edit");
    const docker = fakeDocker({ baseline: 0.9, candidate: 0.9 });

    await runCommand(runOptions(docker, { mode: "dual" }));

    const candidate = await written("candidate.json");
    expect(candidate.commit).toMatch(/\+dirty$/);
    expect(candidate.notes.join(" ")).toContain("uncommitted changes");
  });

  it("leaves no git worktrees behind", async () => {
    await feature();
    await runCommand(runOptions(fakeDocker({ baseline: 0.9, candidate: 0.9 }), { mode: "dual" }));

    expect((await git("worktree", "list")).split("\n")).toHaveLength(1);
  });
});
