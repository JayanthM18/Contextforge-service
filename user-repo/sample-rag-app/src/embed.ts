/**
 * OpenAI, Gemini and local embeddings behind one interface.
 *
 * `openai` is the real one. `local` is deterministic, offline and needs no API
 * key: it exists so the runner, evaluator and CI can be exercised end to end
 * without spending money or requiring network access. It is not a quality
 * baseline — never measure RAG quality with it.
 */

import type { AppConfig } from "./config.ts";

export interface Embedder {
  readonly model: string;
  embed(
    texts: readonly string[],
    taskType?: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY",
  ): Promise<number[][]>;
}

const LOCAL_DIMENSIONS = 1024;

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "can",
  "do",
  "does",
  "for",
  "from",
  "has",
  "have",
  "how",
  "in",
  "is",
  "it",
  "its",
  "of",
  "on",
  "or",
  "that",
  "the",
  "their",
  "them",
  "there",
  "this",
  "to",
  "was",
  "were",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "will",
  "with",
  "you",
  "your",
]);

/**
 * Crude suffix stripping. Without it "refund" never matches "refunds" and the
 * offline provider retrieves almost nothing — which makes it useless even for
 * plumbing tests. This is not a real stemmer and does not need to be.
 */
export function stem(token: string): string {
  if (token.length > 4 && token.endsWith("ies")) return `${token.slice(0, -3)}y`;
  if (token.length > 5 && token.endsWith("ing")) return token.slice(0, -3);
  if (token.length > 4 && token.endsWith("ed")) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1);
  return token;
}

export function tokenise(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? [])
    .filter((token) => token.length > 1 && !STOPWORDS.has(token))
    .map(stem);
}

/** FNV-1a, 32-bit. Chosen because it is five lines and needs no dependency. */
function hash(token: string): number {
  let value = 0x811c9dc5;
  for (let i = 0; i < token.length; i += 1) {
    value ^= token.charCodeAt(i);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value;
}

/** How many corpus documents contain each token. */
export function documentFrequencies(corpus: readonly string[]): Map<string, number> {
  const frequencies = new Map<string, number>();

  for (const document of corpus) {
    for (const token of new Set(tokenise(document))) {
      frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
    }
  }
  return frequencies;
}

/**
 * Smoothed inverse document frequency. Without it a term that appears in half
 * the corpus counts as much as a term that appears once, and every
 * cross-reference between documents becomes a false match.
 */
export function createIdf(corpus: readonly string[]): (token: string) => number {
  const frequencies = documentFrequencies(corpus);
  const total = corpus.length;

  return (token) => Math.log((total + 1) / ((frequencies.get(token) ?? 0) + 1)) + 1;
}

/** Hashed TF-IDF bag of words, L2-normalised so cosine similarity is a dot product. */
export function localVector(text: string, idf: (token: string) => number = () => 1): number[] {
  const vector = new Array<number>(LOCAL_DIMENSIONS).fill(0);

  for (const token of tokenise(text)) {
    const bucket = hash(token) % LOCAL_DIMENSIONS;
    vector[bucket] = (vector[bucket] ?? 0) + idf(token);
  }

  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return magnitude === 0 ? vector : vector.map((value) => value / magnitude);
}

interface EmbeddingResponse {
  data?: { embedding?: unknown }[];
}

async function embedWithOpenAi(texts: readonly string[], config: AppConfig): Promise<number[][]> {
  const response = await fetch(`${config.apiBaseUrl}/embeddings`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({ model: config.embeddingModel, input: texts }),
    signal: AbortSignal.timeout(config.requestTimeoutMs),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `Embedding request failed with HTTP ${String(response.status)}: ${detail.slice(0, 400)}`,
    );
  }

  const body = (await response.json()) as EmbeddingResponse;
  const vectors = body.data?.map((entry) => entry.embedding);

  if (vectors?.length !== texts.length) {
    throw new Error(
      `Embedding response returned ${String(vectors?.length ?? 0)} vectors for ` +
        `${String(texts.length)} inputs.`,
    );
  }

  return vectors.map((vector) => {
    if (!Array.isArray(vector)) {
      throw new Error("Embedding response contained a non-array embedding.");
    }
    return vector as number[];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseGeminiVectors(body: unknown, expected: number): number[][] {
  if (!isRecord(body) || !Array.isArray(body.embeddings) || body.embeddings.length !== expected) {
    const returned =
      isRecord(body) && Array.isArray(body.embeddings) ? String(body.embeddings.length) : "no";
    throw new Error(
      `Gemini embedding response returned ${returned} vectors for ${String(expected)} inputs.`,
    );
  }
  return body.embeddings.map((item, index) => {
    const values = isRecord(item) ? item.values : undefined;
    if (!Array.isArray(values)) {
      throw new Error(`Gemini embedding response vector ${String(index)} is invalid.`);
    }
    const vector: number[] = [];
    for (const value of values) {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error(`Gemini embedding response vector ${String(index)} is invalid.`);
      }
      vector.push(value);
    }
    if (vector.length === 0) {
      throw new Error(`Gemini embedding response vector ${String(index)} is empty.`);
    }
    return vector;
  });
}

async function embedWithGemini(
  texts: readonly string[],
  taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY",
  config: AppConfig,
): Promise<number[][]> {
  const baseUrl = config.geminiEmbeddingBaseUrl.replace(/\/+$/, "");
  const model = config.embeddingModel.replace(/^models\//, "");
  const response = await fetch(
    `${baseUrl}/models/${encodeURIComponent(model)}:batchEmbedContents`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": config.apiKey,
      },
      body: JSON.stringify({
        requests: texts.map((text) => ({
          model: `models/${model}`,
          content: { parts: [{ text }] },
          taskType,
        })),
      }),
      signal: AbortSignal.timeout(config.requestTimeoutMs),
    },
  );
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `Gemini embedding request failed with HTTP ${String(response.status)}: ${detail.slice(0, 400)}`,
    );
  }
  return parseGeminiVectors(await response.json(), texts.length);
}

/**
 * `corpus` is the text the index will be built from. The offline provider
 * needs it up front to weight terms; the OpenAI provider ignores it.
 */
export function createEmbedder(config: AppConfig, corpus: readonly string[]): Embedder {
  if (config.provider === "local") {
    const idf = createIdf(corpus);
    return {
      model: "local-hashed-tfidf",
      embed: (texts) => Promise.resolve(texts.map((text) => localVector(text, idf))),
    };
  }

  return {
    model: config.embeddingModel,
    embed: async (texts, taskType = "RETRIEVAL_DOCUMENT") => {
      // The API caps inputs per request; batching keeps the order stable.
      const batchSize = 96;
      const vectors: number[][] = [];
      for (let start = 0; start < texts.length; start += batchSize) {
        const batch = texts.slice(start, start + batchSize);
        vectors.push(
          ...(config.provider === "gemini"
            ? await embedWithGemini(batch, taskType, config)
            : await embedWithOpenAi(batch, config)),
        );
      }
      return vectors;
    },
  };
}
