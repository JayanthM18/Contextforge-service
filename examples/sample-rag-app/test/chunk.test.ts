import { describe, expect, it } from "vitest";

import { chunkDocument, overlapTail } from "../src/chunk.ts";

const options = { size: 100, overlap: 20 };

describe("overlapTail", () => {
  it("is empty when no overlap is configured", () => {
    expect(overlapTail("some text", 0)).toBe("");
  });

  it("returns the whole text when it is shorter than the overlap", () => {
    expect(overlapTail("short", 20)).toBe("short");
  });

  it("cuts at a word boundary so a chunk never starts mid-word", () => {
    expect(overlapTail("the quick brown fox jumps over", 12)).toBe("jumps over");
  });
});

describe("chunkDocument", () => {
  it("gives every chunk a contract-shaped id numbered from one", () => {
    const chunks = chunkDocument("policy.md", "a".repeat(80) + "\n\n" + "b".repeat(80), options);

    expect(chunks.map((chunk) => chunk.id)).toEqual(["policy.md#c1", "policy.md#c2"]);
    expect(chunks.map((chunk) => chunk.index)).toEqual([1, 2]);
    expect(chunks.every((chunk) => chunk.docId === "policy.md")).toBe(true);
  });

  it("packs whole paragraphs together while they fit", () => {
    const chunks = chunkDocument("doc.md", "one\n\ntwo\n\nthree", options);

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.text).toBe("one\n\ntwo\n\nthree");
  });

  it("carries overlap from the previous chunk into the next", () => {
    const first =
      "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho";
    const chunks = chunkDocument("doc.md", `${first}\n\nsecond paragraph here`, options);

    expect(chunks).toHaveLength(2);
    expect(chunks[1]?.text.startsWith("second")).toBe(false);
    expect(chunks[1]?.text.endsWith("second paragraph here")).toBe(true);
  });

  it("hard-splits a paragraph that is longer than the chunk size", () => {
    const chunks = chunkDocument("doc.md", "x".repeat(250), options);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.text.length <= options.size)).toBe(true);
  });

  it("drops blank paragraphs instead of emitting empty chunks", () => {
    const chunks = chunkDocument("doc.md", "one\n\n\n\n   \n\ntwo", options);

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.text).toBe("one\n\ntwo");
  });

  it("is deterministic: the same input yields identical ids and text", () => {
    const text = "para one\n\n" + "y".repeat(150) + "\n\npara three";

    expect(chunkDocument("d.md", text, options)).toEqual(chunkDocument("d.md", text, options));
  });
});
