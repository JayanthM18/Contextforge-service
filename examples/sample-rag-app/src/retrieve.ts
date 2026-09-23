/** Retrieval. Pure functions over vectors, so it is cheap to test exactly. */

import type { IndexedChunk, ScoredChunk } from "./types.ts";

export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) {
    throw new Error(
      `Cannot compare vectors of different lengths (${String(a.length)} and ${String(b.length)}). ` +
        `This usually means the index and the query were embedded by different models.`,
    );
  }

  let dot = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;

  for (let i = 0; i < a.length; i += 1) {
    const left = a[i] ?? 0;
    const right = b[i] ?? 0;
    dot += left * right;
    magnitudeA += left * left;
    magnitudeB += right * right;
  }

  const denominator = Math.sqrt(magnitudeA) * Math.sqrt(magnitudeB);
  return denominator === 0 ? 0 : dot / denominator;
}

/**
 * The `topK` highest-scoring chunks, most relevant first. Ties break on chunk
 * id so the ordering is stable across runs — an unstable order would move
 * context ids between otherwise identical runs.
 */
export function retrieve(
  queryVector: readonly number[],
  index: readonly IndexedChunk[],
  topK: number,
): ScoredChunk[] {
  return index
    .map(({ chunk, vector }) => ({ chunk, score: cosineSimilarity(queryVector, vector) }))
    .sort((a, b) => b.score - a.score || a.chunk.id.localeCompare(b.chunk.id))
    .slice(0, topK);
}
