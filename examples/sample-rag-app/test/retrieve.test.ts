import { describe, expect, it } from "vitest";

import { cosineSimilarity, retrieve } from "../src/retrieve.ts";
import type { IndexedChunk } from "../src/types.ts";

function indexed(id: string, vector: number[]): IndexedChunk {
  return { chunk: { id, docId: id.split("#")[0] ?? id, index: 1, text: id }, vector };
}

describe("cosineSimilarity", () => {
  it("scores identical vectors as 1", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 10);
  });

  it("scores orthogonal vectors as 0", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });

  it("ignores magnitude", () => {
    expect(cosineSimilarity([1, 1], [5, 5])).toBeCloseTo(1, 10);
  });

  it("treats a zero vector as unrelated rather than dividing by zero", () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });

  it("names the likely cause when the lengths disagree", () => {
    expect(() => cosineSimilarity([1, 2], [1, 2, 3])).toThrow(/different models/);
  });
});

describe("retrieve", () => {
  const index = [
    indexed("a.md#c1", [1, 0]),
    indexed("b.md#c1", [0.8, 0.6]),
    indexed("c.md#c1", [0, 1]),
  ];

  it("returns the most similar chunks first", () => {
    const hits = retrieve([1, 0], index, 3);

    expect(hits.map((hit) => hit.chunk.id)).toEqual(["a.md#c1", "b.md#c1", "c.md#c1"]);
  });

  it("returns at most topK chunks", () => {
    expect(retrieve([1, 0], index, 2)).toHaveLength(2);
  });

  it("breaks ties on chunk id so the order is stable across runs", () => {
    const tied = [indexed("z.md#c1", [1, 0]), indexed("a.md#c1", [1, 0])];

    expect(retrieve([1, 0], tied, 2).map((hit) => hit.chunk.id)).toEqual(["a.md#c1", "z.md#c1"]);
  });

  it("attaches the score used for ranking", () => {
    expect(retrieve([1, 0], index, 1)[0]?.score).toBeCloseTo(1, 10);
  });
});
