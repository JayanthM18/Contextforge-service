/** Wiring: corpus in, index built once at startup, one question answered at a time. */

import type { AppConfig } from "./config.ts";
import { loadCorpus } from "./corpus.ts";
import { createEmbedder } from "./embed.ts";
import { createGenerator } from "./generate.ts";
import { log } from "./log.ts";
import { retrieve } from "./retrieve.ts";
import type { IndexedChunk, QueryResponse } from "./types.ts";

export interface Pipeline {
  answer(question: string): Promise<QueryResponse>;
  readonly chunkCount: number;
}

export async function buildPipeline(config: AppConfig): Promise<Pipeline> {
  const generator = createGenerator(config);

  const chunks = await loadCorpus(config.knowledgeBaseDir, {
    size: config.chunkSize,
    overlap: config.chunkOverlap,
  });
  log("corpus loaded", { chunks: chunks.length, directory: config.knowledgeBaseDir });

  const texts = chunks.map((chunk) => chunk.text);
  const embedder = createEmbedder(config, texts);
  const vectors = await embedder.embed(texts);
  const index: IndexedChunk[] = chunks.map((chunk, position) => ({
    chunk,
    vector: vectors[position] ?? [],
  }));
  log("index built", { chunks: index.length, embedding_model: embedder.model });

  return {
    chunkCount: index.length,
    answer: async (question) => {
      const startedAt = performance.now();

      const [queryVector] = await embedder.embed([question], "RETRIEVAL_QUERY");
      const retrieved = retrieve(queryVector ?? [], index, config.topK);
      const generation = await generator.generate(question, retrieved);

      return {
        answer: generation.answer,
        contexts: retrieved.map(({ chunk, score }) => ({
          text: chunk.text,
          id: chunk.id,
          score,
        })),
        metadata: {
          latency_ms: Math.round(performance.now() - startedAt),
          ...(generation.tokens === undefined ? {} : { tokens: generation.tokens }),
        },
      };
    },
  };
}
