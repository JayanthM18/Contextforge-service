import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { TestCase } from "@contextforge/shared";
import { beforeEach, describe, expect, it } from "vitest";

import { ComposeProject, composeEnv, projectName } from "../src/runner/compose.js";
import { appHash, buildContexts } from "../src/runner/fingerprint.js";
import { waitForHealthy } from "../src/runner/health.js";
import { queryAll, queryCase } from "../src/runner/query.js";
import { answerSide } from "../src/runner/side.js";
import { failure, fakeExec, silentLogger, testConfig } from "./helpers.js";

const refundCase: TestCase = {
  id: "tc-001",
  question: "Refund window?",
  ground_truth: "30 days",
  reference_context_ids: [],
  hops: "single",
};
const expressCase: TestCase = {
  id: "tc-002",
  question: "Express cost?",
  ground_truth: "$14.95",
  reference_context_ids: [],
  hops: "single",
};
const cases: TestCase[] = [refundCase, expressCase];

/** The URL a fetch was called with, whatever form it came in. */
function urlOf(input: string | URL | Request): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

const goodBody = {
  answer: "30 days.",
  contexts: [{ text: "Refunds within 30 days", id: "refunds.md#c1", score: 0.9 }],
  metadata: { latency_ms: 12 },
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("queryCase", () => {
  const options = {
    baseUrl: "http://app",
    queryPath: "/query",
    timeoutMs: 1000,
    logger: silentLogger,
  };

  it("records the answer, context ids and the app's own latency", async () => {
    const record = await queryCase(refundCase, {
      ...options,
      fetch: () => Promise.resolve(json(goodBody)),
    });

    expect(record).toMatchObject({
      case_id: "tc-001",
      status: "ok",
      answer: "30 days.",
      contexts: [{ id: "refunds.md#c1", text: "Refunds within 30 days" }],
      latency_ms: 12,
    });
  });

  it("keeps a context without an id, as the contract allows", async () => {
    const body = { answer: "a", contexts: [{ text: "t" }] };
    const record = await queryCase(refundCase, {
      ...options,
      fetch: () => Promise.resolve(json(body)),
    });

    expect(record.contexts).toEqual([{ id: null, text: "t" }]);
  });

  it("fails the case, not the run, on a non-2xx response", async () => {
    const record = await queryCase(refundCase, {
      ...options,
      fetch: () => Promise.resolve(json({ e: 1 }, 500)),
    });

    expect(record.status).toBe("failed");
    expect(record.error).toMatch(/^HTTP 500/);
  });

  it("fails the case on a body that breaks the contract, naming the field", async () => {
    const record = await queryCase(refundCase, {
      ...options,
      fetch: () => Promise.resolve(json({ answer: 42, contexts: [] })),
    });

    expect(record.status).toBe("failed");
    expect(record.error).toContain("answer");
  });

  it("fails the case on a network error", async () => {
    const record = await queryCase(refundCase, {
      ...options,
      fetch: () => Promise.reject(new Error("ECONNRESET")),
    });

    expect(record.error).toContain("ECONNRESET");
  });

  it("sends the question as the contract's JSON body", async () => {
    let sent: unknown;
    await queryCase(refundCase, {
      ...options,
      fetch: (_url, init) => {
        sent = JSON.parse(typeof init?.body === "string" ? init.body : "null");
        return Promise.resolve(json(goodBody));
      },
    });

    expect(sent).toEqual({ question: "Refund window?" });
  });

  it("queries every case in order", async () => {
    const records = await queryAll(cases, {
      ...options,
      fetch: () => Promise.resolve(json(goodBody)),
    });

    expect(records.map((r) => r.case_id)).toEqual(["tc-001", "tc-002"]);
  });
});

describe("waitForHealthy", () => {
  function clock() {
    let t = 0;
    return {
      now: () => t,
      sleep: (ms: number) => {
        t += ms;
        return Promise.resolve();
      },
    };
  }

  it("keeps polling through refused connections and 503s", async () => {
    const answers = [
      () => Promise.reject(new Error("ECONNREFUSED")),
      () => Promise.resolve(json({}, 503)),
      () => Promise.resolve(json({ status: "ok" })),
    ];
    let call = 0;

    await waitForHealthy({
      url: "http://app/health",
      timeoutMs: 60_000,
      fetch: () => {
        const next = answers[call++];
        if (next === undefined) throw new Error("polled more often than expected");
        return next();
      },
      ...clock(),
    });

    expect(call).toBe(3);
  });

  it("honours the startup timeout and reports the last answer", async () => {
    const error = await failure(
      waitForHealthy({
        url: "http://app/health",
        timeoutMs: 10_000,
        fetch: () => Promise.resolve(json({}, 503)),
        ...clock(),
      }),
    );

    expect(error.message).toContain("within 10s");
    expect(error.remedy).toContain("HTTP 503");
    expect(error.remedy).toContain("startup_timeout");
  });

  it("fails fast when the container has exited", async () => {
    const error = await failure(
      waitForHealthy({
        url: "http://app/health",
        timeoutMs: 600_000,
        fetch: () => Promise.reject(new Error("ECONNREFUSED")),
        isRunning: () => Promise.resolve(false),
        ...clock(),
      }),
    );

    expect(error.message).toContain("exited before it became healthy");
  });
});

describe("compose", () => {
  it("names projects uniquely per role", () => {
    expect(projectName("Baseline", () => "abcd")).toBe("contextforge-baseline-abcd");
  });

  it("passes only Docker's variables and the passthrough list", () => {
    const env = composeEnv({ PATH: "/bin", OPENAI_API_KEY: "sk", AWS_SECRET: "no" }, [
      "OPENAI_API_KEY",
    ]);

    expect(env).toEqual({ PATH: "/bin", OPENAI_API_KEY: "sk" });
  });

  it("tears down containers, networks and volumes, scoped to its project", async () => {
    const { exec, calls } = fakeExec();
    const compose = new ComposeProject({
      exec,
      logger: silentLogger,
      composeFile: "/r/c.yml",
      service: "rag-app",
      cwd: "/r",
      env: {},
      projectName: "p1",
    });

    await compose.down();

    expect(calls[0]?.args).toEqual([
      "compose",
      "--project-name",
      "p1",
      "--file",
      "/r/c.yml",
      "down",
      "--volumes",
      "--remove-orphans",
      "--timeout",
      "10",
    ]);
  });

  it("does not throw from teardown, because it runs in finally", async () => {
    const { exec } = fakeExec(() => ({ code: 1, stderr: "boom" }));
    const compose = new ComposeProject({
      exec,
      logger: silentLogger,
      composeFile: "c.yml",
      service: "s",
      cwd: "/",
      env: {},
      projectName: "p",
    });

    await expect(compose.down()).resolves.toBeUndefined();
  });
});

describe("app fingerprint", () => {
  let dir = "";
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "contextforge-app-"));
    await mkdir(path.join(dir, "app"));
    await writeFile(path.join(dir, "compose.yml"), "services:\n  rag-app:\n    build: ./app\n");
    await writeFile(path.join(dir, "app", "Dockerfile"), "FROM node:26\n");
    await writeFile(path.join(dir, "app", "package-lock.json"), "{}");
    await writeFile(path.join(dir, "app", "main.ts"), "console.log(1)");
  });

  it("reads build contexts in both Compose forms", () => {
    expect(
      buildContexts({
        services: {
          a: { build: "./a" },
          b: { build: { context: "b", dockerfile: "D" } },
          c: { image: "x" },
        },
      }),
    ).toEqual([
      { context: "./a", dockerfile: "Dockerfile" },
      { context: "b", dockerfile: "D" },
    ]);
  });

  it("changes when the Dockerfile or a lockfile changes", async () => {
    const before = await appHash(path.join(dir, "compose.yml"));
    await writeFile(path.join(dir, "app", "package-lock.json"), '{"changed":true}');

    expect(await appHash(path.join(dir, "compose.yml"))).not.toBe(before);
  });

  it("does not change when source code changes — that is what the PR is testing", async () => {
    const before = await appHash(path.join(dir, "compose.yml"));
    await writeFile(path.join(dir, "app", "main.ts"), "console.log(2)");

    expect(await appHash(path.join(dir, "compose.yml"))).toBe(before);
  });

  it("names a missing compose file", async () => {
    expect((await failure(appHash(path.join(dir, "nope.yml")))).message).toContain("nope.yml");
  });
});

describe("answerSide", () => {
  let checkout = "";
  beforeEach(async () => {
    checkout = await mkdtemp(path.join(tmpdir(), "contextforge-checkout-"));
    await writeFile(path.join(checkout, "compose.yml"), "services:\n  rag-app:\n    image: x\n");
  });

  function options(fetchImpl: typeof fetch, handler?: Parameters<typeof fakeExec>[0]) {
    const recorder = fakeExec(handler);
    return {
      recorder,
      options: {
        role: "candidate" as const,
        checkout,
        composeFile: "compose.yml",
        config: testConfig(),
        cases,
        exec: recorder.exec,
        logger: silentLogger,
        env: {},
        fetch: fetchImpl,
        healthIntervalMs: 1,
      },
    };
  }

  const subcommands = (calls: { args: readonly string[] }[]) => calls.map((c) => c.args[5]);

  it("builds, waits, queries every case, then tears down", async () => {
    const { recorder, options: opts } = options((url) =>
      Promise.resolve(urlOf(url).endsWith("/health") ? json({ status: "ok" }) : json(goodBody)),
    );

    const side = await answerSide(opts);

    expect(side.records.map((r) => r.status)).toEqual(["ok", "ok"]);
    expect(side.appHash).toMatch(/^sha256:/);
    expect(subcommands(recorder.calls)).toEqual(["up", "down"]);
  });

  it("tears down after a forced failure, leaving no stray containers", async () => {
    const { recorder, options: opts } = options(
      () => Promise.reject(new Error("ECONNREFUSED")),
      (_c, args) => ({ code: 0, stdout: args.includes("ps") ? "" : "log line" }),
    );

    const error = await failure(answerSide(opts));

    expect(error.message).toContain("exited before it became healthy");
    expect(error.remedy).toContain("log line");
    expect(subcommands(recorder.calls).at(-1)).toBe("down");
  });

  it("tears down when the build itself fails", async () => {
    const { recorder, options: opts } = options(
      () => Promise.resolve(json({})),
      (_c, args) => ({
        code: args.includes("up") ? 1 : 0,
        stderr: "build failed: missing Dockerfile",
      }),
    );

    const error = await failure(answerSide(opts));

    expect(error.remedy).toContain("missing Dockerfile");
    expect(subcommands(recorder.calls)).toEqual(["up", "down"]);
  });
});
