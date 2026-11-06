import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import type { ServiceError } from "../src/errors.js";
import { LocalEvaluationWorker } from "../src/local-worker.js";
import type { EvaluationJob } from "../src/types.js";

const execFile = promisify(execFileCallback);

const job: EvaluationJob = {
  id: `owner/rag-app:pr:7:${"a".repeat(40)}`,
  deliveryId: "delivery-1",
  installationId: 21,
  repository: {
    owner: "owner",
    name: "rag-app",
    fullName: "owner/rag-app",
    cloneUrl: "https://github.com/owner/rag-app.git",
  },
  commitSha: "a".repeat(40),
  ref: "refs/pull/7/head",
  pullRequestNumber: 7,
  baseSha: "b".repeat(40),
  isFork: true,
  secretsAllowed: false,
};

describe("LocalEvaluationWorker", () => {
  it("refuses fork jobs before accessing the local repository or secrets", async () => {
    const worker = new LocalEvaluationWorker({
      repositoryPath: "missing-repository",
      repositoryName: "owner/rag-app",
      configPath: "contextforge.yml",
      dataDirectory: "missing-data",
      cliPath: "missing-cli",
      timeoutMs: 1000,
      environmentKeys: [],
      environment: {},
    });

    await expect(worker.evaluate(job)).rejects.toMatchObject({
      code: "LOCAL_FORK_DISABLED",
      statusCode: 403,
    } satisfies Partial<ServiceError>);
  });

  it("does not accept push events through the pull-request worker", async () => {
    const worker = new LocalEvaluationWorker({
      repositoryPath: "missing-repository",
      repositoryName: "owner/rag-app",
      configPath: "contextforge.yml",
      dataDirectory: "missing-data",
      cliPath: "missing-cli",
      timeoutMs: 1000,
      environmentKeys: [],
      environment: {},
    });

    await expect(
      worker.evaluate({
        ...job,
        isFork: false,
        secretsAllowed: true,
        pullRequestNumber: null,
        baseSha: null,
      }),
    ).rejects.toMatchObject({
      code: "LOCAL_JOB_UNSUPPORTED",
      statusCode: 400,
    } satisfies Partial<ServiceError>);
  });

  it("fetches and evaluates the event SHA from a clean temporary worktree", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "contextforge-local-worker-test-"));
    const bare = path.join(root, "origin.git");
    const author = path.join(root, "author");
    const clone = path.join(root, "clone");
    const data = path.join(root, "data");
    const cli = path.join(root, "fake-cli.mjs");
    const remoteUrl = "https://github.com/owner/rag-app.git";
    const localOrigin = pathToFileURL(bare).href;
    const git = async (cwd: string, args: readonly string[]) =>
      execFile("git", ["-C", cwd, ...args], { windowsHide: true });

    try {
      await execFile("git", ["init", "--bare", "--initial-branch=main", bare]);
      await execFile("git", ["init", "--initial-branch=main", author]);
      await git(author, ["config", "user.name", "ContextForge Test"]);
      await git(author, ["config", "user.email", "contextforge@example.test"]);
      await writeFile(path.join(author, "contextforge.yml"), "version: 1\n");
      await git(author, ["add", "contextforge.yml"]);
      await git(author, ["commit", "-m", "baseline"]);
      const baseSha = (await git(author, ["rev-parse", "HEAD"])).stdout.trim();
      await git(author, ["remote", "add", "origin", remoteUrl]);
      await git(author, ["config", "--add", `url.${localOrigin}.insteadOf`, remoteUrl]);
      await git(author, ["push", "-u", "origin", "main"]);

      await execFile("git", ["clone", "--branch", "main", bare, clone]);
      await git(clone, ["remote", "set-url", "origin", remoteUrl]);
      await git(clone, ["config", "--add", `url.${localOrigin}.insteadOf`, remoteUrl]);
      await git(clone, ["config", "user.name", "ContextForge Test"]);
      await git(clone, ["config", "user.email", "contextforge@example.test"]);
      await writeFile(path.join(clone, "change.txt"), "candidate\n");
      await git(clone, ["add", "change.txt"]);
      await git(clone, ["commit", "-m", "candidate"]);
      const commitSha = (await git(clone, ["rev-parse", "HEAD"])).stdout.trim();
      await git(clone, ["push", "origin", "HEAD:refs/heads/feature"]);

      await writeFile(
        cli,
        `import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
if (process.env.GITHUB_APP_PRIVATE_KEY || process.env.CONTEXTFORGE_WEBHOOK_SECRET || process.env.OPENAI_API_KEY) process.exit(5);
if (process.env.APP_TEST_KEY !== "app-value") process.exit(6);
const args = process.argv.slice(2);
const output = args[args.indexOf("--output") + 1];
const candidate = args[args.indexOf("--candidate") + 1];
const baseline = args[args.indexOf("--baseline") + 1];
await mkdir(output, { recursive: true });
await writeFile(path.join(output, "report.md"), candidate + " " + baseline);
await writeFile(path.join(output, "results.json"), JSON.stringify({ verdict: { status: "pass" } }));
`,
      );

      const worker = new LocalEvaluationWorker({
        repositoryPath: clone,
        repositoryName: "owner/rag-app",
        configPath: "contextforge.yml",
        dataDirectory: data,
        cliPath: cli,
        timeoutMs: 120_000,
        environmentKeys: ["APP_TEST_KEY"],
        environment: {
          ...process.env,
          APP_TEST_KEY: "app-value",
          OPENAI_API_KEY: "must-not-leak",
          GIT_TERMINAL_PROMPT: "0",
          GCM_INTERACTIVE: "Never",
        },
      });
      const outcome = await worker.evaluate({
        ...job,
        commitSha,
        baseSha,
        isFork: false,
        secretsAllowed: true,
      });

      expect(outcome).toMatchObject({
        status: "pass",
        reportMarkdown: `${commitSha} ${baseSha}`,
      });
      const worktrees = await git(clone, ["worktree", "list", "--porcelain"]);
      expect(worktrees.stdout).not.toContain("contextforge-local-job-");
      await expect(readFile(path.join(clone, "change.txt"), "utf8")).resolves.toBe("candidate\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);
});
