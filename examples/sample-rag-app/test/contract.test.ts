/**
 * The app contract from `docs/DESIGN.md` section 1, asserted against the real
 * server and the real knowledge base. Runs on the offline provider, so there
 * is no network call and no API key.
 */

import type { AddressInfo } from "node:net";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.ts";
import { buildPipeline, type Pipeline } from "../src/pipeline.ts";
import { createServer } from "../src/server.ts";

const knowledgeBase = path.join(import.meta.dirname, "..", "docs", "knowledge-base");
const config = loadConfig({ PROVIDER: "local", KNOWLEDGE_BASE_DIR: knowledgeBase });

let pipeline: Pipeline | undefined;
let baseUrl = "";
const server = createServer({
  isReady: () => pipeline !== undefined,
  answer: async (question) => {
    if (pipeline === undefined) throw new Error("not ready");
    return pipeline.answer(question);
  },
});

async function get(route: string): Promise<Response> {
  return fetch(`${baseUrl}${route}`);
}

async function post(route: string, body: string): Promise<Response> {
  return fetch(`${baseUrl}${route}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
});

describe("GET /health", () => {
  it("reports 503 while the index is still building", async () => {
    const response = await get("/health");

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "starting" });
  });

  it('returns 200 and {"status":"ok"} once ready', async () => {
    pipeline = await buildPipeline(config);
    const response = await get("/health");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });
});

describe("POST /query", () => {
  it("answers with the exact contract shape", async () => {
    const response = await post(
      "/query",
      JSON.stringify({ question: "What is the refund window?" }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;

    expect(Object.keys(body).sort()).toEqual(["answer", "contexts", "metadata"]);
    expect(typeof body.answer).toBe("string");
    expect(body.answer).not.toBe("");
    expect(Array.isArray(body.contexts)).toBe(true);
  });

  it("returns topK contexts, each with a text, an id and a score", async () => {
    const response = await post(
      "/query",
      JSON.stringify({ question: "How long do returns take?" }),
    );
    const body = (await response.json()) as {
      contexts: { text: unknown; id: unknown; score: unknown }[];
    };

    expect(body.contexts).toHaveLength(config.topK);
    for (const context of body.contexts) {
      expect(typeof context.text).toBe("string");
      expect(context.text).not.toBe("");
      // `<file>#c<n>`, the id format the contract requires.
      expect(context.id).toMatch(/^[\w-]+\.md#c\d+$/);
      expect(typeof context.score).toBe("number");
    }
  });

  it("orders contexts most relevant first", async () => {
    const response = await post("/query", JSON.stringify({ question: "Can I cancel an order?" }));
    const body = (await response.json()) as { contexts: { score: number }[] };
    const scores = body.contexts.map((context) => context.score);

    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  it("returns unique context ids", async () => {
    const response = await post("/query", JSON.stringify({ question: "How do I track a parcel?" }));
    const body = (await response.json()) as { contexts: { id: string }[] };
    const ids = body.contexts.map((context) => context.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it("reports latency in metadata", async () => {
    const response = await post(
      "/query",
      JSON.stringify({ question: "What payment methods work?" }),
    );
    const body = (await response.json()) as { metadata: { latency_ms: unknown } };

    expect(typeof body.metadata.latency_ms).toBe("number");
    expect(body.metadata.latency_ms).toBeGreaterThanOrEqual(0);
  });

  it("retrieves the refund policy for a refund question", async () => {
    const response = await post(
      "/query",
      JSON.stringify({ question: "What is the refund window?" }),
    );
    const body = (await response.json()) as { contexts: { id: string }[] };

    expect(body.contexts.some((context) => context.id.startsWith("returns-and-refunds.md"))).toBe(
      true,
    );
  });

  it("rejects a missing question with 400, not 500", async () => {
    const response = await post("/query", JSON.stringify({ q: "wrong field" }));

    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toContain("question");
  });

  it("rejects an empty question", async () => {
    const response = await post("/query", JSON.stringify({ question: "   " }));

    expect(response.status).toBe(400);
  });

  it("rejects a body that is not JSON", async () => {
    const response = await post("/query", "not json at all");

    expect(response.status).toBe(400);
  });
});

describe("unknown routes", () => {
  it("returns 404 naming the method and path", async () => {
    const response = await get("/nope");

    expect(response.status).toBe(404);
    expect(((await response.json()) as { error: string }).error).toContain("/nope");
  });
});
