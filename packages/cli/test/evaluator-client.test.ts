import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildScoreRequest,
  checkResponse,
  ensureEvaluatorImage,
  evaluatorImage,
  evaluatorRunArgs,
  keyVariables,
  scoreCases,
} from "../src/evaluator/client.js";
import type { ScoreRequest, ScoreResponse } from "../src/evaluator/types.js";
import { ContextForgeError } from "../src/util/errors.js";
import { fakeExec, silentLogger, testConfig } from "./helpers.js";

const cases = [
  { case_id: "tc-001", question: "q1?", ground_truth: "t1", answer: "a1", contexts: ["c1"] },
  { case_id: "tc-002", question: "q2?", ground_truth: "t2", answer: "a2", contexts: ["c2"] },
];

function request(): ScoreRequest {
  return buildScoreRequest(testConfig(), cases);
}

function responseFor(req: ScoreRequest, score = 0.8): ScoreResponse {
  return {
    evaluator: { ragas_version: "0.4.3", judge_model: req.judge.model, embeddings_model: null },
    results: req.cases.map((c) => ({
      case_id: c.case_id,
      scores: Object.fromEntries(req.metrics.map((m) => [m, score])),
      errors: {},
    })),
  };
}

/** A fake `docker run` that behaves like the evaluator: reads the request, writes a response. */
function fakeEvaluator(respond: (req: ScoreRequest) => unknown, code = 0) {
  return fakeExec(async (_command, args) => {
    const mount = args[args.indexOf("--volume") + 1] ?? "";
    const workdir = mount.split(":")[0] ?? "";
    const req = JSON.parse(
      await readFile(path.join(workdir, "request.json"), "utf8"),
    ) as ScoreRequest;
    if (code === 0)
      await writeFile(path.join(workdir, "response.json"), JSON.stringify(respond(req)));
    return { code, stderr: code === 0 ? "INFO scored 2/2 cases\n" : "ERROR 401 invalid key\n" };
  });
}

const env = { OPENAI_API_KEY: "sk-test", PATH: "/usr/bin" };

async function failure(promise: Promise<unknown>): Promise<ContextForgeError> {
  try {
    await promise;
  } catch (error: unknown) {
    if (error instanceof ContextForgeError) return error;
    throw error;
  }
  throw new Error("expected a ContextForgeError");
}

describe("buildScoreRequest", () => {
  it("carries the judge's temperature and seed explicitly", () => {
    const req = request();

    expect(req.judge).toMatchObject({ model: "gpt-4o-mini", temperature: 0, seed: 42 });
    expect(req.cases).toHaveLength(2);
    expect(req.embeddings?.model).toBe("text-embedding-3-small");
  });
});

describe("keyVariables", () => {
  it("lists each key variable once, even when judge and embeddings share one", () => {
    expect(keyVariables(request())).toEqual(["OPENAI_API_KEY"]);
  });

  it("lists none for a keyless local judge", () => {
    const req = {
      ...request(),
      judge: { ...request().judge, api_key_env: null },
      embeddings: null,
    };

    expect(keyVariables(req)).toEqual([]);
  });
});

describe("evaluatorRunArgs", () => {
  const base = {
    image: "img",
    workdir: "/tmp/w",
    keyVariables: ["OPENAI_API_KEY"],
    user: "1000:1000",
  };

  it("uses host networking on Linux so a tailnet or LAN judge is reachable unchanged", () => {
    expect(evaluatorRunArgs({ ...base, platform: "linux" })).toEqual(
      expect.arrayContaining(["--network", "host"]),
    );
  });

  it("maps host.docker.internal elsewhere", () => {
    const args = evaluatorRunArgs({ ...base, platform: "darwin" });

    expect(args).toContain("host.docker.internal:host-gateway");
    expect(args).not.toContain("host");
  });

  it("passes the key by name only, so it never appears on the command line", () => {
    const args = evaluatorRunArgs({ ...base, platform: "linux" });

    expect(args).toContain("OPENAI_API_KEY");
    expect(args.join(" ")).not.toContain("sk-");
  });

  it("runs as the calling user so the response file is writable", () => {
    expect(evaluatorRunArgs({ ...base, platform: "linux" })).toEqual(
      expect.arrayContaining(["--user", "1000:1000"]),
    );
  });
});

describe("ensureEvaluatorImage", () => {
  it("uses an existing image without building", async () => {
    const { exec, calls } = fakeExec(() => ({ code: 0 }));

    await ensureEvaluatorImage({ exec, logger: silentLogger, env });

    expect(calls.map((c) => c.args[0])).toEqual(["image"]);
  });

  it("builds the runtime target when the image is missing", async () => {
    const { exec, calls } = fakeExec((_c, args) => ({ code: args[0] === "image" ? 1 : 0 }));

    await ensureEvaluatorImage({ exec, logger: silentLogger, env });

    expect(calls[1]?.args).toEqual(expect.arrayContaining(["build", "--target", "runtime"]));
  });

  it("uses a supplied image as-is", async () => {
    const { exec, calls } = fakeExec();
    const supplied = { ...env, CONTEXTFORGE_EVALUATOR_IMAGE: "ghcr.io/x/evaluator:1" };

    expect(await ensureEvaluatorImage({ exec, logger: silentLogger, env: supplied })).toBe(
      "ghcr.io/x/evaluator:1",
    );
    expect(calls).toEqual([]);
  });

  it("names the tool version in the default tag", () => {
    expect(evaluatorImage({})).toMatch(/^contextforge-evaluator:\d+\.\d+\.\d+$/);
  });
});

describe("scoreCases", () => {
  it("round-trips a request through the container", async () => {
    const { exec } = fakeEvaluator((req) => responseFor(req, 0.9));

    const response = await scoreCases("img", request(), {
      exec,
      logger: silentLogger,
      env,
      user: null,
    });

    expect(response.results.map((r) => r.case_id)).toEqual(["tc-001", "tc-002"]);
    expect(response.results[0]?.scores.faithfulness).toBe(0.9);
  });

  it("gives the container only the key variable, not the whole environment", async () => {
    const { exec, calls } = fakeEvaluator((req) => responseFor(req));

    await scoreCases("img", request(), {
      exec,
      logger: silentLogger,
      env: { ...env, AWS_SECRET_ACCESS_KEY: "leak" },
      user: null,
    });

    expect(calls[0]?.options?.env).toHaveProperty("OPENAI_API_KEY", "sk-test");
    expect(calls[0]?.options?.env).not.toHaveProperty("AWS_SECRET_ACCESS_KEY");
  });

  it("removes its temporary directory afterwards", async () => {
    let workdir = "";
    const { exec } = fakeEvaluator((req) => responseFor(req));
    const spy: typeof exec = async (command, args, options) => {
      workdir = (args[args.indexOf("--volume") + 1] ?? "").split(":")[0] ?? "";
      return exec(command, args, options);
    };

    await scoreCases("img", request(), { exec: spy, logger: silentLogger, env, user: null });

    expect(workdir).not.toBe("");
    expect(existsSync(workdir)).toBe(false);
  });

  it("fails before starting a container when the key variable is unset", async () => {
    const { exec, calls } = fakeEvaluator((req) => responseFor(req));

    const error = await failure(
      scoreCases("img", request(), { exec, logger: silentLogger, env: {}, user: null }),
    );

    expect(error.message).toContain("OPENAI_API_KEY");
    expect(calls).toEqual([]);
  });

  it("reports a failed container with its last output", async () => {
    const { exec } = fakeEvaluator((req) => responseFor(req), 2);

    const error = await failure(
      scoreCases("img", request(), { exec, logger: silentLogger, env, user: null }),
    );

    expect(error.code).toBe("EVALUATOR_FAILED");
    expect(error.remedy).toContain("401 invalid key");
  });

  it("rejects a response that breaks the contract", async () => {
    const { exec } = fakeEvaluator(() => ({ results: "nope" }));

    const error = await failure(
      scoreCases("img", request(), { exec, logger: silentLogger, env, user: null }),
    );

    expect(error.message).toContain("breaks the contract");
  });

  it("scores nothing without starting a container when there are no cases", async () => {
    const { exec, calls } = fakeExec();
    const empty = buildScoreRequest(testConfig(), []);

    expect(
      (await scoreCases("img", empty, { exec, logger: silentLogger, env, user: null })).results,
    ).toEqual([]);
    expect(calls).toEqual([]);
  });
});

describe("checkResponse", () => {
  it("rejects results in a different order from the request", () => {
    const req = request();
    const res = responseFor(req);
    res.results.reverse();

    expect(() => {
      checkResponse(req, res);
    }).toThrow(/returned cases \[tc-002, tc-001\]/);
  });

  it("rejects a missing metric", () => {
    const req = request();
    const res = responseFor(req);
    delete res.results[0]?.scores.faithfulness;

    expect(() => {
      checkResponse(req, res);
    }).toThrow(/no faithfulness score for tc-001/);
  });

  it("accepts null scores, which are real outcomes", () => {
    const req = request();
    const res = responseFor(req);
    const first = res.results[0];
    if (first) first.scores.faithfulness = null;

    expect(() => {
      checkResponse(req, res);
    }).not.toThrow();
  });
});
