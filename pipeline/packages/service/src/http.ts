import { createHmac, timingSafeEqual } from "node:crypto";
import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";

import { ServiceError } from "./errors.js";
import {
  pullRequestEventSchema,
  pushEventSchema,
  type EvaluationJob,
  type ReportReader,
  type WebhookDependencies,
} from "./types.js";

const WEBHOOK_PATH = "/webhooks/github";
const REPORT_PATH = /^\/reports\/([0-9a-f]{64})$/;
const MAX_BODY_BYTES = 1_048_576;
const ZERO_SHA = "0".repeat(40);

interface RequestLike extends AsyncIterable<Uint8Array> {
  readonly method?: string | undefined;
  readonly url?: string | undefined;
  readonly headers: IncomingHttpHeaders;
}

interface ResponseLike {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body?: string): void;
}

function header(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

export function verifyWebhookSignature(
  body: Uint8Array,
  signature: string | undefined,
  secret: string,
): boolean {
  if (signature === undefined || !/^sha256=[0-9a-f]{64}$/i.test(signature) || secret.length === 0) {
    return false;
  }
  const expected = createHmac("sha256", secret).update(body).digest();
  const supplied = Buffer.from(signature.slice("sha256=".length), "hex");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

async function readBody(request: RequestLike): Promise<Buffer> {
  const contentLength = header(request.headers, "content-length");
  if (contentLength !== undefined && Number(contentLength) > MAX_BODY_BYTES) {
    throw new ServiceError("WEBHOOK_TOO_LARGE", "GitHub webhook body exceeds 1 MiB.", 413);
  }

  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.byteLength;
    if (length > MAX_BODY_BYTES) {
      throw new ServiceError("WEBHOOK_TOO_LARGE", "GitHub webhook body exceeds 1 MiB.", 413);
    }
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks, length);
}

function jobFromEvent(eventType: string, raw: unknown, deliveryId: string): EvaluationJob | null {
  if (eventType === "pull_request") {
    const parsed = pullRequestEventSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ServiceError("WEBHOOK_INVALID", "Pull request webhook payload is invalid.", 400, {
        cause: parsed.error,
      });
    }
    const event = parsed.data;
    if (!["opened", "reopened", "synchronize"].includes(event.action)) return null;

    const headRepository = event.pull_request.head.repo?.full_name;
    const isFork = headRepository?.toLowerCase() !== event.repository.full_name.toLowerCase();
    const number = event.pull_request.number;
    const sha = event.pull_request.head.sha.toLowerCase();
    return {
      id: `${event.repository.full_name.toLowerCase()}:pr:${String(number)}:${sha}`,
      deliveryId,
      installationId: event.installation.id,
      repository: {
        owner: event.repository.owner.login,
        name: event.repository.name,
        fullName: event.repository.full_name,
        cloneUrl: event.repository.clone_url,
      },
      commitSha: sha,
      ref: `refs/pull/${String(number)}/head`,
      pullRequestNumber: number,
      baseSha: event.pull_request.base.sha.toLowerCase(),
      isFork,
      secretsAllowed: !isFork,
    };
  }

  if (eventType === "push") {
    const parsed = pushEventSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ServiceError("WEBHOOK_INVALID", "Push webhook payload is invalid.", 400, {
        cause: parsed.error,
      });
    }
    const event = parsed.data;
    if (
      event.deleted === true ||
      event.after === ZERO_SHA ||
      event.ref !== `refs/heads/${event.repository.default_branch}`
    ) {
      return null;
    }
    return {
      id: `${event.repository.full_name.toLowerCase()}:push:${event.after.toLowerCase()}`,
      deliveryId,
      installationId: event.installation.id,
      repository: {
        owner: event.repository.owner.login,
        name: event.repository.name,
        fullName: event.repository.full_name,
        cloneUrl: event.repository.clone_url,
      },
      commitSha: event.after.toLowerCase(),
      ref: event.ref,
      pullRequestNumber: null,
      baseSha: null,
      isFork: false,
      secretsAllowed: true,
    };
  }

  return null;
}

function send(response: ResponseLike, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

export function createWebhookHandler(dependencies: WebhookDependencies) {
  if (dependencies.webhookSecret.length === 0) {
    throw new ServiceError(
      "SERVICE_CONFIGURATION_INVALID",
      "CONTEXTFORGE_WEBHOOK_SECRET must be set to a non-empty GitHub webhook secret.",
      500,
    );
  }

  return async (request: RequestLike, response: ResponseLike): Promise<void> => {
    if (request.method !== "POST" || request.url !== WEBHOOK_PATH) {
      send(response, 404, { error: "not_found" });
      return;
    }

    try {
      const body = await readBody(request);
      if (
        !verifyWebhookSignature(
          body,
          header(request.headers, "x-hub-signature-256"),
          dependencies.webhookSecret,
        )
      ) {
        throw new ServiceError(
          "WEBHOOK_INVALID",
          "GitHub webhook signature is missing or invalid.",
          401,
        );
      }

      const deliveryId = header(request.headers, "x-github-delivery");
      const eventType = header(request.headers, "x-github-event");
      if (
        !deliveryId ||
        deliveryId.length > 200 ||
        hasControlCharacter(deliveryId) ||
        !eventType ||
        eventType.length > 100
      ) {
        throw new ServiceError(
          "WEBHOOK_INVALID",
          "GitHub delivery and event headers are required.",
          400,
        );
      }

      let payload: unknown;
      try {
        payload = JSON.parse(body.toString("utf8")) as unknown;
      } catch (error: unknown) {
        throw new ServiceError("WEBHOOK_INVALID", "GitHub webhook body is not valid JSON.", 400, {
          cause: error,
        });
      }

      const job = jobFromEvent(eventType, payload, deliveryId);
      if (job === null || (job.pullRequestNumber === null && dependencies.acceptPush === false)) {
        send(response, 202, { status: "ignored" });
        return;
      }

      const result = await dependencies.jobs.enqueueIfAbsent(job);
      send(response, 202, {
        status: result.created ? "queued" : "already_queued",
        job_id: result.job.id,
        commit: result.job.commitSha,
      });
    } catch (error: unknown) {
      if (error instanceof ServiceError) {
        send(response, error.statusCode, { error: error.code, message: error.message });
        return;
      }
      dependencies.logger.error("Could not queue GitHub webhook evaluation", {
        error_name: error instanceof Error ? error.name : "unknown",
      });
      send(response, 503, {
        error: "SERVICE_UNAVAILABLE",
        message: "Could not queue evaluation; GitHub may retry this delivery.",
      });
    }
  };
}

export function createWebhookServer(
  dependencies: WebhookDependencies,
  reports?: ReportReader,
): Server {
  const handler = createWebhookHandler(dependencies);
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    if (request.method === "GET" && request.url === "/health") {
      send(response, 200, { status: "ok" });
      return;
    }
    const reportMatch = request.url?.match(REPORT_PATH);
    if (request.method === "GET" && reportMatch !== null && reportMatch !== undefined) {
      if (reports === undefined) {
        send(response, 404, { error: "not_found" });
        return;
      }
      void reports.read(reportMatch[1] ?? "").then(
        (html) => {
          if (html === null) {
            send(response, 404, { error: "not_found" });
            return;
          }
          response.statusCode = 200;
          response.setHeader("content-type", "text/html; charset=utf-8");
          response.setHeader(
            "content-security-policy",
            "default-src 'none'; style-src 'unsafe-inline'",
          );
          response.setHeader("x-content-type-options", "nosniff");
          response.end(html);
        },
        (error: unknown) => {
          dependencies.logger.error("Could not read an evaluation report", {
            error_name: error instanceof Error ? error.name : "unknown",
          });
          send(response, 500, { error: "REPORT_UNAVAILABLE" });
        },
      );
      return;
    }
    void handler(request, response);
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  return server;
}
