import { createHmac } from "node:crypto";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";

import { createWebhookHandler } from "../src/http.js";
import type { EvaluationJob, WebhookDependencies } from "../src/types.js";

const secret = "local-webhook-secret";
const sha = "a".repeat(40);

function request(body: string, eventType: string, deliveryId = "delivery-1", signatureBody = body) {
  const rawBody = Buffer.from(body);
  return {
    method: "POST",
    url: "/webhooks/github",
    headers: {
      "x-hub-signature-256": `sha256=${createHmac("sha256", secret).update(signatureBody).digest("hex")}`,
      "x-github-delivery": deliveryId,
      "x-github-event": eventType,
      "content-length": String(rawBody.byteLength),
    },
    [Symbol.asyncIterator]: () => Readable.from([rawBody])[Symbol.asyncIterator](),
  };
}

function response() {
  const headers: Record<string, string> = {};
  const result = {
    statusCode: 0,
    body: "",
    headers,
    setHeader: (name: string, value: string) => {
      headers[name] = value;
    },
    end: (body = "") => {
      result.body = body;
    },
  };
  return result;
}

function dependencies(
  enqueueIfAbsent: (job: EvaluationJob) => Promise<{ job: EvaluationJob; created: boolean }>,
) {
  const logger = { error: vi.fn() };
  const deps: WebhookDependencies = {
    webhookSecret: secret,
    jobs: { enqueueIfAbsent },
    logger,
  };
  return { deps, logger };
}

function pullRequest(action = "synchronize", isFork = false): string {
  const repository = {
    full_name: "owner/rag-app",
    owner: { login: "owner" },
    name: "rag-app",
    clone_url: "https://github.com/owner/rag-app.git",
  };
  return JSON.stringify({
    action,
    installation: { id: 21 },
    repository,
    pull_request: {
      number: 7,
      head: {
        sha,
        ref: "feature/rag-change",
        repo: isFork
          ? {
              full_name: "contributor/rag-app",
              owner: { login: "contributor" },
              name: "rag-app",
              clone_url: "https://github.com/contributor/rag-app.git",
            }
          : repository,
      },
      base: { sha: "b".repeat(40), ref: "main" },
    },
  });
}

describe("GitHub webhook handler", () => {
  it("verifies signatures and queues the exact PR head without fork secrets", async () => {
    let queued: EvaluationJob | undefined;
    const { deps } = dependencies((job) => {
      queued = job;
      return Promise.resolve({ job, created: true });
    });
    const handler = createWebhookHandler(deps);
    const res = response();

    await handler(request(pullRequest("opened", true), "pull_request"), res);

    expect(res.statusCode).toBe(202);
    expect(JSON.parse(res.body)).toMatchObject({ status: "queued", commit: sha });
    expect(queued).toMatchObject({
      installationId: 21,
      repository: {
        fullName: "owner/rag-app",
        cloneUrl: "https://github.com/owner/rag-app.git",
      },
      commitSha: sha,
      ref: "refs/pull/7/head",
      pullRequestNumber: 7,
      baseSha: "b".repeat(40),
      isFork: true,
      secretsAllowed: false,
    });
  });

  it("does not enqueue unsupported pull-request actions", async () => {
    const enqueue = vi.fn((job: EvaluationJob) => Promise.resolve({ job, created: true }));
    const { deps } = dependencies(enqueue);
    const res = response();

    await createWebhookHandler(deps)(request(pullRequest("closed"), "pull_request"), res);

    expect(res.statusCode).toBe(202);
    expect(JSON.parse(res.body)).toEqual({ status: "ignored" });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("only queues pushes to the repository default branch", async () => {
    const enqueue = vi.fn((job: EvaluationJob) => Promise.resolve({ job, created: true }));
    const { deps } = dependencies(enqueue);
    const repository = {
      full_name: "owner/rag-app",
      owner: { login: "owner" },
      name: "rag-app",
      clone_url: "https://github.com/owner/rag-app.git",
      default_branch: "main",
    };
    const payload = JSON.stringify({
      installation: { id: 21 },
      repository,
      ref: "refs/heads/main",
      after: sha,
    });
    const res = response();

    await createWebhookHandler(deps)(request(payload, "push"), res);

    expect(res.statusCode).toBe(202);
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        commitSha: sha,
        ref: "refs/heads/main",
        pullRequestNumber: null,
        secretsAllowed: true,
      }),
    );

    const featurePush = JSON.stringify({
      installation: { id: 21 },
      repository,
      ref: "refs/heads/feature",
      after: sha,
    });
    const ignored = response();
    await createWebhookHandler(deps)(request(featurePush, "push", "delivery-2"), ignored);
    expect(JSON.parse(ignored.body)).toEqual({ status: "ignored" });
    expect(enqueue).toHaveBeenCalledOnce();
  });

  it("returns the canonical job for a duplicate delivery", async () => {
    const canonicalJob: EvaluationJob = {
      id: `owner/rag-app:pr:7:${sha}`,
      deliveryId: "delivery-1",
      installationId: 21,
      repository: {
        owner: "owner",
        name: "rag-app",
        fullName: "owner/rag-app",
        cloneUrl: "https://github.com/owner/rag-app.git",
      },
      commitSha: sha,
      ref: "refs/pull/7/head",
      pullRequestNumber: 7,
      baseSha: "b".repeat(40),
      isFork: false,
      secretsAllowed: true,
    };
    const { deps } = dependencies(() => Promise.resolve({ job: canonicalJob, created: false }));
    const res = response();

    await createWebhookHandler(deps)(request(pullRequest(), "pull_request"), res);

    expect(JSON.parse(res.body)).toEqual({
      status: "already_queued",
      job_id: canonicalJob.id,
      commit: sha,
    });
  });

  it("returns an error for a bad signature without enqueueing", async () => {
    const enqueue = vi.fn((job: EvaluationJob) => Promise.resolve({ job, created: true }));
    const { deps } = dependencies(enqueue);
    const raw = request(pullRequest(), "pull_request");
    const res = response();

    await createWebhookHandler(deps)(
      { ...raw, headers: { ...raw.headers, "x-hub-signature-256": `sha256=${"0".repeat(64)}` } },
      res,
    );

    expect(res.statusCode).toBe(401);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("returns 503 when durable job enqueueing fails so GitHub can retry", async () => {
    const logger = { error: vi.fn() };
    const deps: WebhookDependencies = {
      webhookSecret: secret,
      jobs: {
        enqueueIfAbsent: () => Promise.reject(new Error("storage unavailable")),
      },
      logger,
    };
    const res = response();

    await createWebhookHandler(deps)(request(pullRequest(), "pull_request"), res);

    expect(res.statusCode).toBe(503);
    expect(JSON.parse(res.body)).toMatchObject({ error: "SERVICE_UNAVAILABLE" });
    expect(logger.error).toHaveBeenCalledOnce();
    expect(res.body).not.toContain("storage unavailable");
  });
});
