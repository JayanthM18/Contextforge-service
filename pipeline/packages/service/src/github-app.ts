import { createPrivateKey, createSign } from "node:crypto";

import { z } from "zod";

import { ServiceError } from "./errors.js";
import type { CheckRunPublisher, EvaluationJob } from "./types.js";

const accessTokenSchema = z.object({
  token: z.string().min(1),
  expires_at: z.iso.datetime({ offset: true }),
});

const checkRunsSchema = z.object({
  total_count: z.number().int().nonnegative(),
  check_runs: z.array(
    z.object({
      id: z.number().int().positive(),
      external_id: z.string().nullable(),
    }),
  ),
});

const checkRunSchema = z.object({ id: z.number().int().positive() });
const issueCommentsSchema = z.array(
  z.object({
    id: z.number().int().positive(),
    body: z.string().nullable(),
    user: z.object({ type: z.string() }).nullable(),
  }),
);
const issueCommentSchema = z.object({ id: z.number().int().positive() });

export interface GitHubAppOptions {
  readonly appId: string;
  readonly privateKey: string;
  readonly apiUrl?: string;
  readonly fetch?: typeof fetch;
  readonly now?: () => Date;
}

interface InstallationToken {
  readonly value: string;
  readonly expiresAt: number;
}

function base64Url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

function appJwt(appId: string, privateKey: string, now: Date): string {
  const issuedAt = Math.floor(now.getTime() / 1000) - 60;
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({ iat: issuedAt, exp: issuedAt + 9 * 60, iss: appId }));
  const unsigned = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  return `${unsigned}.${signer.sign(privateKey).toString("base64url")}`;
}

export class GitHubAppClient implements CheckRunPublisher {
  private readonly apiUrl: string;
  private readonly fetcher: typeof fetch;
  private readonly now: () => Date;
  private readonly privateKey: string;
  private readonly tokenCache = new Map<number, InstallationToken>();

  constructor(private readonly options: GitHubAppOptions) {
    if (!/^\d+$/.test(options.appId)) {
      throw new ServiceError(
        "SERVICE_CONFIGURATION_INVALID",
        "GITHUB_APP_ID must be a positive numeric GitHub App ID.",
        500,
      );
    }
    const privateKey = options.privateKey.replace(/\\n/g, "\n");
    if (privateKey.trim().length === 0) {
      throw new ServiceError(
        "SERVICE_CONFIGURATION_INVALID",
        "GITHUB_APP_PRIVATE_KEY must contain the GitHub App PEM private key.",
        500,
      );
    }
    try {
      createPrivateKey(privateKey);
    } catch (error: unknown) {
      throw new ServiceError(
        "SERVICE_CONFIGURATION_INVALID",
        "GITHUB_APP_PRIVATE_KEY is not a valid PEM private key.",
        500,
        { cause: error },
      );
    }
    const apiUrl = options.apiUrl ?? "https://api.github.com";
    let parsedApiUrl: URL;
    try {
      parsedApiUrl = new URL(apiUrl);
    } catch (error: unknown) {
      throw new ServiceError(
        "SERVICE_CONFIGURATION_INVALID",
        "GitHub API URL must be a valid HTTPS URL.",
        500,
        { cause: error },
      );
    }
    if (parsedApiUrl.protocol !== "https:") {
      throw new ServiceError(
        "SERVICE_CONFIGURATION_INVALID",
        "GitHub API URL must use HTTPS.",
        500,
      );
    }
    this.apiUrl = apiUrl.replace(/\/+$/, "");
    this.fetcher = options.fetch ?? globalThis.fetch;
    this.now = options.now ?? (() => new Date());
    this.privateKey = privateKey;
  }

  async createQueued(job: EvaluationJob): Promise<number> {
    const existing = await this.findCheckRun(job);
    if (existing !== null) return existing;

    const response = await this.request(
      job.installationId,
      `/repos/${encodeURIComponent(job.repository.owner)}/${encodeURIComponent(job.repository.name)}/check-runs`,
      {
        method: "POST",
        body: JSON.stringify({
          name: "ContextForge",
          head_sha: job.commitSha,
          external_id: job.id,
          status: "queued",
          output: {
            title: "Evaluation queued",
            summary: "ContextForge accepted this commit for RAG evaluation.",
          },
        }),
      },
    );
    return (await this.parseResponse(response, checkRunSchema, "create check run")).id;
  }

  async start(job: EvaluationJob, checkRunId: number): Promise<void> {
    await this.request(job.installationId, this.checkPath(job, checkRunId), {
      method: "PATCH",
      body: JSON.stringify({
        status: "in_progress",
        started_at: this.now().toISOString(),
        output: {
          title: "Evaluation in progress",
          summary: `Evaluating commit ${job.commitSha}.`,
        },
      }),
    });
  }

  async complete(
    job: EvaluationJob,
    checkRunId: number,
    result:
      | { readonly status: "pass" | "regression"; readonly reportUrl: string }
      | { readonly status: "tool_error"; readonly code: string; readonly safeMessage: string },
  ): Promise<void> {
    const outcome =
      result.status === "tool_error"
        ? {
            conclusion: "failure",
            title: `Tool error: ${result.code}`,
            summary: result.safeMessage,
            details_url: undefined,
          }
        : {
            conclusion: result.status === "pass" ? "success" : "failure",
            title: result.status === "pass" ? "RAG evaluation passed" : "RAG regression detected",
            summary:
              result.status === "pass"
                ? "No configured quality threshold was breached."
                : "One or more configured quality thresholds were breached.",
            details_url: result.reportUrl,
          };

    await this.request(job.installationId, this.checkPath(job, checkRunId), {
      method: "PATCH",
      body: JSON.stringify({
        status: "completed",
        completed_at: this.now().toISOString(),
        conclusion: outcome.conclusion,
        output: { title: outcome.title, summary: outcome.summary },
        ...(outcome.details_url === undefined ? {} : { details_url: outcome.details_url }),
      }),
    });
  }

  async publishPullRequestResult(
    job: EvaluationJob,
    result:
      | { readonly status: "pass" | "regression"; readonly reportUrl: string }
      | { readonly status: "tool_error"; readonly code: string; readonly safeMessage: string },
  ): Promise<void> {
    if (job.pullRequestNumber === null) return;

    const marker = `<!-- contextforge-app-${this.options.appId}-result -->`;
    const body = this.pullRequestComment(marker, job, result);
    const existingCommentId = await this.findPullRequestComment(job, marker);
    const path =
      existingCommentId === null
        ? `/repos/${encodeURIComponent(job.repository.owner)}/${encodeURIComponent(job.repository.name)}/issues/${String(job.pullRequestNumber)}/comments`
        : `/repos/${encodeURIComponent(job.repository.owner)}/${encodeURIComponent(job.repository.name)}/issues/comments/${String(existingCommentId)}`;

    const response = await this.request(job.installationId, path, {
      method: existingCommentId === null ? "POST" : "PATCH",
      body: JSON.stringify({ body }),
    });
    await this.parseResponse(response, issueCommentSchema, "publish pull request result");
  }

  private pullRequestComment(
    marker: string,
    job: EvaluationJob,
    result:
      | { readonly status: "pass" | "regression"; readonly reportUrl: string }
      | { readonly status: "tool_error"; readonly code: string; readonly safeMessage: string },
  ): string {
    const commit = `\`${job.commitSha}\``;
    if (result.status === "tool_error") {
      return `${marker}\n## ContextForge evaluation error: ${result.code}\n\n${result.safeMessage}\n\nEvaluated commit: ${commit}`;
    }

    const passed = result.status === "pass";
    const title = passed ? "RAG evaluation passed" : "RAG regression detected";
    const summary = passed
      ? "No configured quality threshold was breached."
      : "One or more configured quality thresholds were breached.";
    return `${marker}\n## ContextForge: ${title}\n\n${summary}\n\nEvaluated commit: ${commit}\n\n[View the detailed evaluation report](${result.reportUrl})`;
  }

  private async findPullRequestComment(job: EvaluationJob, marker: string): Promise<number | null> {
    if (job.pullRequestNumber === null) return null;
    const basePath = `/repos/${encodeURIComponent(job.repository.owner)}/${encodeURIComponent(job.repository.name)}/issues/${String(job.pullRequestNumber)}/comments?per_page=100&page=`;
    let page = 1;
    let read = 0;
    while (read < 1000) {
      const response = await this.request(job.installationId, `${basePath}${String(page)}`, {
        method: "GET",
      });
      const comments = await this.parseResponse(
        response,
        issueCommentsSchema,
        "list pull request comments",
      );
      const existing = comments.find(
        (comment) => comment.user?.type === "Bot" && comment.body?.includes(marker) === true,
      );
      if (existing !== undefined) return existing.id;
      read += comments.length;
      if (comments.length < 100) return null;
      page += 1;
    }
    throw new ServiceError(
      "GITHUB_API_FAILED",
      "Could not safely find the ContextForge pull request comment after reading 1,000 comments.",
      502,
    );
  }

  private checkPath(job: EvaluationJob, checkRunId: number): string {
    return `/repos/${encodeURIComponent(job.repository.owner)}/${encodeURIComponent(job.repository.name)}/check-runs/${String(checkRunId)}`;
  }

  private async findCheckRun(job: EvaluationJob): Promise<number | null> {
    const basePath = `/repos/${encodeURIComponent(job.repository.owner)}/${encodeURIComponent(job.repository.name)}/commits/${encodeURIComponent(job.commitSha)}/check-runs?check_name=ContextForge&per_page=100&page=`;
    let page = 1;
    let read = 0;
    while (read < 1000) {
      const response = await this.request(job.installationId, `${basePath}${String(page)}`, {
        method: "GET",
      });
      const result = await this.parseResponse(response, checkRunsSchema, "list check runs");
      const existing = result.check_runs.find((check) => check.external_id === job.id);
      if (existing !== undefined) return existing.id;
      read += result.check_runs.length;
      if (read >= result.total_count || result.check_runs.length === 0) return null;
      page += 1;
    }
    throw new ServiceError(
      "GITHUB_API_FAILED",
      "Could not safely check for an existing ContextForge Check Run after reading 1,000 runs.",
      502,
    );
  }

  private async installationToken(installationId: number): Promise<string> {
    const cached = this.tokenCache.get(installationId);
    const now = this.now().getTime();
    if (cached !== undefined && cached.expiresAt > now + 60_000) return cached.value;

    const jwt = appJwt(this.options.appId, this.privateKey, this.now());
    const response = await this.fetchResponse(
      `${this.apiUrl}/app/installations/${String(installationId)}/access_tokens`,
      {
        method: "POST",
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${jwt}`,
          "x-github-api-version": "2022-11-28",
        },
      },
    );
    const token = await this.parseResponse(
      response,
      accessTokenSchema,
      "create installation token",
    );
    const value = { value: token.token, expiresAt: Date.parse(token.expires_at) };
    this.tokenCache.set(installationId, value);
    return value.value;
  }

  private async request(
    installationId: number,
    path: string,
    options: { readonly method: "GET" | "POST" | "PATCH"; readonly body?: string },
  ): Promise<Response> {
    const token = await this.installationToken(installationId);
    const response = await this.fetchResponse(`${this.apiUrl}${path}`, {
      method: options.method,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "x-github-api-version": "2022-11-28",
        ...(options.body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(options.body === undefined ? {} : { body: options.body }),
    });
    if (!response.ok) {
      throw new ServiceError(
        "GITHUB_API_FAILED",
        `GitHub API request failed with HTTP ${String(response.status)} for ${options.method} ${path.split("?")[0] ?? path}.`,
        502,
      );
    }
    return response;
  }

  private async fetchResponse(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetcher(url, init);
    } catch (error: unknown) {
      throw new ServiceError(
        "GITHUB_API_FAILED",
        "GitHub API request failed before a response was received.",
        502,
        { cause: error },
      );
    }
  }

  private async parseResponse<T>(
    response: Response,
    schema: z.ZodType<T>,
    operation: string,
  ): Promise<T> {
    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error: unknown) {
      throw new ServiceError(
        "GITHUB_API_FAILED",
        `GitHub returned invalid JSON while attempting to ${operation}.`,
        502,
        { cause: error },
      );
    }
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      throw new ServiceError(
        "GITHUB_API_FAILED",
        `GitHub returned an unexpected response while attempting to ${operation}.`,
        502,
        { cause: parsed.error },
      );
    }
    return parsed.data;
  }
}
