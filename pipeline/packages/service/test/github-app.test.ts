import { createVerify, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";

import { ServiceError } from "../src/errors.js";
import { GitHubAppClient } from "../src/github-app.js";
import type { EvaluationJob } from "../src/types.js";

const job: EvaluationJob = {
  id: "owner/rag-app:pr:7:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  deliveryId: "delivery-id",
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
  isFork: false,
  secretsAllowed: true,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function inputUrl(input: unknown): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  if (
    typeof input === "object" &&
    input !== null &&
    "url" in input &&
    typeof input.url === "string"
  ) {
    return input.url;
  }
  throw new Error("test fetch received an unsupported URL input");
}

function requestBody(call: { readonly init: RequestInit } | undefined): string {
  if (typeof call?.init.body !== "string") return "";
  return call.init.body;
}

describe("GitHub App Check Run client", () => {
  it("rejects an invalid private key at startup", () => {
    expect(
      () =>
        new GitHubAppClient({
          appId: "12345",
          privateKey: "not-a-private-key",
        }),
    ).toThrow(
      expect.objectContaining({
        code: "SERVICE_CONFIGURATION_INVALID",
      }),
    );
  });

  it("creates an installation token and a check for the exact commit", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    const calls: { url: string; init: RequestInit }[] = [];
    const fetcher: typeof fetch = (input, init = {}) => {
      const url = inputUrl(input);
      calls.push({ url, init });
      if (url.endsWith("/app/installations/21/access_tokens")) {
        const authorization = new Headers(init.headers).get("authorization");
        expect(authorization).toMatch(/^Bearer /);
        const jwt = authorization?.slice("Bearer ".length) ?? "";
        const [header, payload, signature] = jwt.split(".");
        if (header === undefined || payload === undefined || signature === undefined) {
          throw new Error("expected a signed JWT");
        }
        const verifier = createVerify("RSA-SHA256");
        verifier.update(`${header}.${payload}`);
        verifier.end();
        expect(verifier.verify(publicKey, signature, "base64url")).toBe(true);
        return Promise.resolve(
          jsonResponse({
            token: "installation-token",
            expires_at: "2026-12-01T00:00:00Z",
          }),
        );
      }
      if (url.includes("/check-runs?")) {
        return Promise.resolve(jsonResponse({ total_count: 0, check_runs: [] }));
      }
      return Promise.resolve(jsonResponse({ id: 99 }, url.endsWith("/check-runs") ? 201 : 200));
    };
    const client = new GitHubAppClient({
      appId: "12345",
      privateKey,
      fetch: fetcher,
      now: () => new Date("2026-11-02T10:00:00Z"),
    });

    const checkRunId = await client.createQueued(job);
    await client.start(job, checkRunId);
    await client.complete(job, checkRunId, {
      status: "regression",
      reportUrl: "https://reports.example.test/report/abc",
    });

    expect(checkRunId).toBe(99);
    expect(calls).toHaveLength(5);
    expect(requestBody(calls[2])).toContain(job.commitSha);
    expect(requestBody(calls[2])).toContain(job.id);
    expect(requestBody(calls[4])).toContain('"conclusion":"failure"');
    expect(requestBody(calls[4])).toContain("https://reports.example.test/report/abc");
    expect(
      calls.filter(({ url }) => url.endsWith("/app/installations/21/access_tokens")),
    ).toHaveLength(1);
  });

  it("maps tool errors to a failing check with a distinct title", async () => {
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    const bodies: string[] = [];
    const fetcher: typeof fetch = (input, init = {}) => {
      const url = inputUrl(input);
      if (url.endsWith("/app/installations/21/access_tokens")) {
        return Promise.resolve(
          jsonResponse({
            token: "installation-token",
            expires_at: "2026-12-01T00:00:00Z",
          }),
        );
      }
      if (url.includes("/check-runs?")) {
        return Promise.resolve(jsonResponse({ total_count: 0, check_runs: [] }));
      }
      if (typeof init.body === "string") bodies.push(init.body);
      return Promise.resolve(jsonResponse({ id: 99 }, url.endsWith("/check-runs") ? 201 : 200));
    };
    const client = new GitHubAppClient({
      appId: "12345",
      privateKey,
      fetch: fetcher,
    });

    const checkRunId = await client.createQueued(job);
    await client.complete(job, checkRunId, {
      status: "tool_error",
      code: "WORKER_FAILED",
      safeMessage: "Worker failed; retry the check.",
    });

    expect(bodies[1]).toContain("Tool error: WORKER_FAILED");
    expect(bodies[1]).toContain('"conclusion":"failure"');
    expect(bodies[1]).not.toContain("details_url");
  });

  it("reuses a check run already associated with the stable job id", async () => {
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    const urls: string[] = [];
    const fetcher: typeof fetch = (input) => {
      const url = inputUrl(input);
      urls.push(url);
      if (url.endsWith("/app/installations/21/access_tokens")) {
        return Promise.resolve(
          jsonResponse({
            token: "installation-token",
            expires_at: "2026-12-01T00:00:00Z",
          }),
        );
      }
      return Promise.resolve(
        jsonResponse({
          total_count: 1,
          check_runs: [{ id: 71, external_id: job.id }],
        }),
      );
    };
    const client = new GitHubAppClient({
      appId: "12345",
      privateKey,
      fetch: fetcher,
    });

    await expect(client.createQueued(job)).resolves.toBe(71);
    expect(urls).toHaveLength(2);
    expect(urls[1]).toContain("/check-runs?check_name=ContextForge");
  });

  it("creates and updates one result comment for the PR", async () => {
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    const calls: { url: string; init: RequestInit }[] = [];
    let comments: { id: number; body: string; user: { type: string } }[] = [];
    const fetcher: typeof fetch = (input, init = {}) => {
      const url = inputUrl(input);
      calls.push({ url, init });
      if (url.endsWith("/app/installations/21/access_tokens")) {
        return Promise.resolve(
          jsonResponse({
            token: "installation-token",
            expires_at: "2026-12-01T00:00:00Z",
          }),
        );
      }
      if (url.includes("/issues/7/comments?")) {
        return Promise.resolve(jsonResponse(comments));
      }
      if (url.endsWith("/issues/7/comments")) {
        const body =
          typeof init.body === "string" ? (JSON.parse(init.body) as { body: string }) : null;
        if (body === null) throw new Error("expected comment body");
        comments = [{ id: 82, body: body.body, user: { type: "Bot" } }];
        return Promise.resolve(jsonResponse({ id: 82 }, 201));
      }
      if (url.endsWith("/issues/comments/82")) {
        const body =
          typeof init.body === "string" ? (JSON.parse(init.body) as { body: string }) : null;
        if (body === null) throw new Error("expected comment body");
        comments = [{ id: 82, body: body.body, user: { type: "Bot" } }];
        return Promise.resolve(jsonResponse({ id: 82 }));
      }
      throw new Error(`unexpected GitHub API URL: ${url}`);
    };
    const client = new GitHubAppClient({
      appId: "12345",
      privateKey,
      fetch: fetcher,
    });

    await client.publishPullRequestResult(job, {
      status: "regression",
      reportUrl: "https://reports.example.test/report/abc",
    });
    await client.publishPullRequestResult(job, {
      status: "pass",
      reportUrl: "https://reports.example.test/report/def",
    });
    await client.publishPullRequestResult(job, {
      status: "tool_error",
      code: "WORKER_FAILED",
      safeMessage: "Evaluation could not complete.",
    });

    const commentWrites = calls.filter(
      ({ url, init }) =>
        (url.includes("/issues/7/comments") && init.method === "POST") ||
        (url.endsWith("/issues/comments/82") && init.method === "PATCH"),
    );
    expect(commentWrites).toHaveLength(3);
    expect(commentWrites[0]?.url).toContain("/issues/7/comments");
    expect(requestBody(commentWrites[0])).toContain("RAG regression detected");
    expect(requestBody(commentWrites[0])).toContain(job.commitSha);
    expect(requestBody(commentWrites[0])).toContain("https://reports.example.test/report/abc");
    expect(commentWrites[1]?.url).toContain("/issues/comments/82");
    expect(requestBody(commentWrites[1])).toContain("RAG evaluation passed");
    expect(requestBody(commentWrites[2])).toContain("ContextForge evaluation error: WORKER_FAILED");
    expect(requestBody(commentWrites[2])).toContain("Evaluation could not complete.");
    expect(comments).toHaveLength(1);
    expect(comments[0]?.body).toContain("<!-- contextforge-app-12345-result -->");
  });

  it("does not expose GitHub response bodies in API errors", async () => {
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    const fetcher: typeof fetch = (input) =>
      Promise.resolve(
        inputUrl(input).endsWith("/access_tokens")
          ? jsonResponse({ token: "installation-token", expires_at: "2026-12-01T00:00:00Z" })
          : new Response("sensitive provider response", { status: 403 }),
      );
    const client = new GitHubAppClient({
      appId: "12345",
      privateKey,
      fetch: fetcher,
    });

    const error = await client.createQueued(job).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ServiceError);
    if (!(error instanceof ServiceError)) return;
    expect(error.code).toBe("GITHUB_API_FAILED");
    expect(error.message).not.toContain("sensitive provider response");
  });
});
