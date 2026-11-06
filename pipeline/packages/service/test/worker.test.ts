import { describe, expect, it, vi } from "vitest";

import { ServiceError } from "../src/errors.js";
import { runEvaluationJob } from "../src/worker.js";
import type { EvaluationJob, EvaluationJobDependencies } from "../src/types.js";

const job: EvaluationJob = {
  id: "owner/rag-app:push:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  deliveryId: "delivery-id",
  installationId: 21,
  repository: {
    owner: "owner",
    name: "rag-app",
    fullName: "owner/rag-app",
    cloneUrl: "https://github.com/owner/rag-app.git",
  },
  commitSha: "a".repeat(40),
  ref: "refs/heads/main",
  pullRequestNumber: null,
  baseSha: null,
  isFork: false,
  secretsAllowed: true,
};

function dependencies(overrides: Partial<EvaluationJobDependencies> = {}) {
  const completed: unknown[] = [];
  const operations: string[] = [];
  const logger = { error: vi.fn() };
  const createQueued = vi.fn(() => Promise.resolve(42));
  const start = vi.fn(() => Promise.resolve());
  const complete = vi.fn((_job: EvaluationJob, _id: number, result: unknown) => {
    operations.push("check");
    completed.push(result);
    return Promise.resolve();
  });
  const publishPullRequestResult = vi.fn(() => {
    operations.push("comment");
    return Promise.resolve();
  });
  const evaluate = vi.fn(() =>
    Promise.resolve({
      status: "pass" as const,
      reportMarkdown: "# Pass",
      reportJson: "{}",
    }),
  );
  const claim = vi.fn(() => Promise.resolve({ status: "acquired" as const }));
  const saveCompletion = vi.fn(() => {
    operations.push("save");
    return Promise.resolve();
  });
  const release = vi.fn(() => Promise.resolve());
  const markNotificationsDelivered = vi.fn(() => {
    operations.push("delivered");
    return Promise.resolve();
  });
  const put = vi.fn(() => Promise.resolve("https://reports.example.test/report/42"));
  const deps: EvaluationJobDependencies = {
    checks: {
      createQueued,
      start,
      complete,
      publishPullRequestResult,
    },
    executions: { claim, saveCompletion, markNotificationsDelivered, release },
    worker: { evaluate },
    reports: { put },
    logger,
    ...overrides,
  };
  return {
    deps,
    completed,
    logger,
    createQueued,
    start,
    put,
    claim,
    saveCompletion,
    release,
    operations,
    evaluate,
    complete,
    publishPullRequestResult,
    markNotificationsDelivered,
  };
}

describe("evaluation job orchestration", () => {
  it("starts the check, stores the report, and publishes the final verdict", async () => {
    const {
      deps,
      completed,
      createQueued,
      start,
      put,
      saveCompletion,
      operations,
      evaluate,
      publishPullRequestResult,
      markNotificationsDelivered,
    } = dependencies();

    await runEvaluationJob(job, deps);

    expect(evaluate).toHaveBeenCalledWith(job);
    expect(createQueued).toHaveBeenCalledWith(job);
    expect(start).toHaveBeenCalledWith(job, 42);
    expect(put).toHaveBeenCalledWith(job, "# Pass", "{}");
    expect(saveCompletion).toHaveBeenCalledOnce();
    expect(operations).toEqual(["save", "check", "comment", "delivered"]);
    expect(completed).toEqual([
      { status: "pass", reportUrl: "https://reports.example.test/report/42" },
    ]);
    expect(publishPullRequestResult).toHaveBeenCalledWith(job, completed[0]);
    expect(markNotificationsDelivered).toHaveBeenCalledWith(job.id);
  });

  it("converts worker exceptions into a safe tool-error check result", async () => {
    const { deps, completed, logger } = dependencies({
      worker: {
        evaluate: vi.fn(() =>
          Promise.reject(new Error("provider secret must not appear in the report")),
        ),
      },
    });

    await runEvaluationJob(job, deps);

    expect(completed).toEqual([
      {
        status: "tool_error",
        code: "WORKER_FAILED",
        safeMessage:
          "ContextForge could not complete this evaluation. Review service logs or retry.",
      },
    ]);
    expect(logger.error).toHaveBeenCalledOnce();
    expect(JSON.stringify(completed)).not.toContain("provider secret");
  });

  it("reports safe ServiceError details in the check and service log", async () => {
    const { deps, completed, logger } = dependencies({
      worker: {
        evaluate: vi.fn(() =>
          Promise.reject(
            new ServiceError(
              "LOCAL_EVALUATION_FAILED",
              "The evaluation CLI exited with status 2: Gemini embedding quota exceeded (HTTP 429).",
              500,
            ),
          ),
        ),
      },
    });

    await runEvaluationJob(job, deps);

    expect(completed).toEqual([
      {
        status: "tool_error",
        code: "LOCAL_EVALUATION_FAILED",
        safeMessage: "The evaluation CLI exited with status 2: Gemini embedding quota exceeded (HTTP 429).",
      },
    ]);
    expect(logger.error).toHaveBeenCalledWith("Isolated evaluation failed", {
      job_id: job.id,
      error_name: "ServiceError",
      error_code: "LOCAL_EVALUATION_FAILED",
      error_message: "The evaluation CLI exited with status 2: Gemini embedding quota exceeded (HTTP 429).",
    });
  });

  it("reports storage failures instead of returning a success-shaped result", async () => {
    const { deps, completed } = dependencies({
      reports: {
        put: vi.fn(() => Promise.reject(new Error("object store unavailable"))),
      },
    });

    await runEvaluationJob(job, deps);

    expect(completed).toEqual([
      {
        status: "tool_error",
        code: "REPORT_STORAGE_FAILED",
        safeMessage:
          "ContextForge could not persist the evaluation report. Review service logs or retry.",
      },
    ]);
  });

  it("rejects report links that are not HTTPS", async () => {
    const { deps, completed } = dependencies({
      reports: { put: () => Promise.resolve("http://reports.example.test/report/42") },
    });

    await runEvaluationJob(job, deps);

    expect(completed).toEqual([
      {
        status: "tool_error",
        code: "REPORT_STORAGE_FAILED",
        safeMessage:
          "ContextForge could not persist the evaluation report. Review service logs or retry.",
      },
    ]);
  });

  it("does not run a job already leased by another worker", async () => {
    const { deps, evaluate } = dependencies({
      executions: {
        claim: () => Promise.resolve({ status: "busy" }),
        saveCompletion: () => Promise.resolve(),
        markNotificationsDelivered: () => Promise.resolve(),
        release: () => Promise.resolve(),
      },
    });

    await runEvaluationJob(job, deps);

    expect(evaluate).not.toHaveBeenCalled();
  });

  it("re-publishes a persisted completion without rerunning the evaluation", async () => {
    const storedResult = {
      status: "regression" as const,
      reportUrl: "https://reports.example.test/report/stored",
    };
    const { deps, evaluate, complete, publishPullRequestResult } = dependencies({
      executions: {
        claim: () =>
          Promise.resolve({
            status: "completed",
            completion: { checkRunId: 55, result: storedResult, notificationsDelivered: false },
          }),
        saveCompletion: () => Promise.resolve(),
        markNotificationsDelivered: vi.fn(() => Promise.resolve()),
        release: () => Promise.resolve(),
      },
    });

    await runEvaluationJob(job, deps);

    expect(evaluate).not.toHaveBeenCalled();
    expect(complete).toHaveBeenCalledWith(job, 55, storedResult);
    expect(publishPullRequestResult).toHaveBeenCalledWith(job, storedResult);
  });

  it("retries failed PR delivery without evaluating the commit again", async () => {
    const storedResult = {
      status: "pass" as const,
      reportUrl: "https://reports.example.test/report/42",
    };
    const { deps, evaluate, release, markNotificationsDelivered, publishPullRequestResult } =
      dependencies();
    deps.executions.claim = vi
      .fn()
      .mockResolvedValueOnce({ status: "acquired" as const })
      .mockResolvedValueOnce({
        status: "completed" as const,
        completion: { checkRunId: 42, result: storedResult, notificationsDelivered: false },
      });
    publishPullRequestResult
      .mockRejectedValueOnce(new Error("GitHub temporarily unavailable"))
      .mockResolvedValueOnce(undefined);

    await expect(runEvaluationJob(job, deps)).rejects.toThrow("GitHub temporarily unavailable");
    await runEvaluationJob(job, deps);

    expect(evaluate).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
    expect(markNotificationsDelivered).toHaveBeenCalledOnce();
  });
});
