/**
 * Answer generation. Temperature is 0 and the seed is fixed, because the app
 * contract requires two runs of the same question to be comparable.
 */

import type { AppConfig } from "./config.ts";
import { tokenise } from "./embed.ts";
import type { ScoredChunk, TokenUsage } from "./types.ts";

export interface Generation {
  readonly answer: string;
  readonly tokens?: TokenUsage;
}

export interface Generator {
  readonly model: string;
  generate(question: string, contexts: readonly ScoredChunk[]): Promise<Generation>;
}

const SYSTEM_PROMPT = [
  "You are a support assistant for Northwind Supply Co.",
  "Answer the question using only the numbered context passages provided.",
  "If the passages do not contain the answer, say that you do not know.",
  "Answer in at most three sentences. Do not mention the passages or their numbers.",
].join(" ");

export function buildUserPrompt(question: string, contexts: readonly ScoredChunk[]): string {
  const passages = contexts
    .map((context, position) => `[${String(position + 1)}] ${context.chunk.text}`)
    .join("\n\n");

  return `Context passages:\n\n${passages}\n\nQuestion: ${question}`;
}

interface ChatResponse {
  choices?: { message?: { content?: unknown } }[];
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
}

function countOf(value: unknown): number {
  return typeof value === "number" ? value : 0;
}

async function generateWithOpenAi(
  question: string,
  contexts: readonly ScoredChunk[],
  config: AppConfig,
): Promise<Generation> {
  const response = await fetch(`${config.apiBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.generationModel,
      temperature: 0,
      seed: 42,
      // Only when set: models that do not reason reject the parameter.
      ...(config.reasoningEffort === null ? {} : { reasoning_effort: config.reasoningEffort }),
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(question, contexts) },
      ],
    }),
    signal: AbortSignal.timeout(config.requestTimeoutMs),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `Generation request failed with HTTP ${String(response.status)}: ${detail.slice(0, 400)}`,
    );
  }

  const body = (await response.json()) as ChatResponse;
  const content = body.choices?.[0]?.message?.content;

  if (typeof content !== "string") {
    throw new Error("Generation response did not contain a message string.");
  }

  return {
    answer: content.trim(),
    tokens: {
      prompt: countOf(body.usage?.prompt_tokens),
      completion: countOf(body.usage?.completion_tokens),
    },
  };
}

/**
 * Offline generator: returns the sentences from the retrieved passages that
 * overlap the question most. Extractive, deterministic and obviously not an
 * LLM — it exists to exercise plumbing, not to produce a quality number.
 */
export function extractiveAnswer(question: string, contexts: readonly ScoredChunk[]): string {
  const wanted = new Set(tokenise(question));
  if (contexts.length === 0) return "I do not know.";

  const sentences = contexts.flatMap((context) =>
    context.chunk.text
      .split(/(?<=[.!?])\s+|\n+/)
      .map((sentence) => sentence.replace(/\s+/g, " ").trim())
      .filter((sentence) => sentence.length > 20),
  );

  const ranked = sentences
    .map((sentence, position) => ({
      sentence,
      position,
      overlap: tokenise(sentence).filter((token) => wanted.has(token)).length,
    }))
    .filter((entry) => entry.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap || a.position - b.position)
    .slice(0, 2);

  if (ranked.length === 0) return "I do not know.";

  return ranked
    .sort((a, b) => a.position - b.position)
    .map((entry) => entry.sentence)
    .join(" ");
}

export function createGenerator(config: AppConfig): Generator {
  if (config.provider === "local") {
    return {
      model: "local-extractive",
      generate: (question, contexts) =>
        Promise.resolve({ answer: extractiveAnswer(question, contexts) }),
    };
  }

  return {
    model: config.generationModel,
    generate: (question, contexts) => generateWithOpenAi(question, contexts, config),
  };
}
