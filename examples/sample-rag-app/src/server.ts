/**
 * The HTTP surface defined by the app contract in `docs/DESIGN.md` section 1.
 * Only two routes exist, and nothing here knows about ContextForge.
 */

import { createServer as createHttpServer, type IncomingMessage, type Server } from "node:http";

import { log } from "./log.ts";
import type { QueryResponse } from "./types.ts";

/** A body larger than this is a mistake or an attack; either way, refuse it. */
const MAX_BODY_BYTES = 64 * 1024;

export interface ServerOptions {
  /** False until the index is built. `/health` stays 503 until it is true. */
  readonly isReady: () => boolean;
  readonly answer: (question: string) => Promise<QueryResponse>;
}

class BadRequestError extends Error {
  override readonly name = "BadRequestError";
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_BODY_BYTES) {
      throw new BadRequestError(`Request body exceeds ${String(MAX_BODY_BYTES)} bytes.`);
    }
    chunks.push(buffer);
  }

  return Buffer.concat(chunks).toString("utf8");
}

function parseQuestion(body: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (cause) {
    throw new BadRequestError("Request body is not valid JSON.", { cause });
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new BadRequestError('Request body must be a JSON object: { "question": "..." }');
  }

  const question = (parsed as { question?: unknown }).question;
  if (typeof question !== "string") {
    throw new BadRequestError('Field "question" is required and must be a string.');
  }
  if (question.trim().length === 0) {
    throw new BadRequestError('Field "question" must not be empty.');
  }

  return question;
}

export function createServer(options: ServerOptions): Server {
  return createHttpServer((request, response) => {
    const send = (status: number, body: unknown): void => {
      const payload = JSON.stringify(body);
      response.writeHead(status, {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(payload),
      });
      response.end(payload);
    };

    const handle = async (): Promise<void> => {
      const url = request.url ?? "/";
      const route = url.split("?")[0] ?? "/";

      if (request.method === "GET" && route === "/health") {
        if (options.isReady()) {
          send(200, { status: "ok" });
        } else {
          // Not an error: the runner polls here while the index is building.
          send(503, { status: "starting" });
        }
        return;
      }

      if (request.method === "POST" && route === "/query") {
        const question = parseQuestion(await readBody(request));
        send(200, await options.answer(question));
        return;
      }

      send(404, { error: `No route for ${request.method ?? "?"} ${route}` });
    };

    void handle().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);

      if (error instanceof BadRequestError) {
        send(400, { error: message });
        return;
      }

      // A failed query fails that request only; the process stays up so the
      // remaining test cases still run.
      log("request failed", { url: request.url, error: message });
      send(500, { error: message });
    });
  });
}
