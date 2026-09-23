import { describe, expect, it } from "vitest";

import { createIdf, documentFrequencies, localVector, stem, tokenise } from "../src/embed.ts";
import { cosineSimilarity } from "../src/retrieve.ts";

describe("tokenise", () => {
  it("lowercases, splits on non-alphanumerics and drops stopwords", () => {
    expect(tokenise("What is the Refund window?")).toEqual(["refund", "window"]);
  });

  it("drops single characters", () => {
    expect(tokenise("a b refund")).toEqual(["refund"]);
  });
});

describe("stem", () => {
  it("strips a plural so a singular query matches a plural document", () => {
    expect(stem("refunds")).toBe("refund");
    expect(stem("days")).toBe("day");
  });

  it("maps -ies to -y", () => {
    expect(stem("policies")).toBe("policy");
  });

  it("strips -ing and -ed", () => {
    expect(stem("shipping")).toBe("shipp");
    expect(stem("cancelled")).toBe("cancell");
  });

  it("leaves a double s alone, so 'address' does not become 'addres'", () => {
    expect(stem("address")).toBe("address");
  });

  it("leaves short words alone", () => {
    expect(stem("is")).toBe("is");
    expect(stem("gas")).toBe("gas");
  });
});

describe("documentFrequencies", () => {
  it("counts documents containing a token, not occurrences of it", () => {
    const frequencies = documentFrequencies(["refund refund refund", "refund policy"]);

    expect(frequencies.get("refund")).toBe(2);
    expect(frequencies.get("policy")).toBe(1);
  });
});

describe("createIdf", () => {
  it("weights a rare term above a common one", () => {
    const idf = createIdf(["refund policy", "refund shipping", "refund warranty", "refund tax"]);

    expect(idf("warranty")).toBeGreaterThan(idf("refund"));
  });

  it("gives an unseen term the highest weight rather than zero", () => {
    const idf = createIdf(["refund policy", "refund shipping"]);

    expect(idf("kayak")).toBeGreaterThan(idf("refund"));
  });
});

describe("localVector", () => {
  it("is deterministic, which is the whole point of the offline provider", () => {
    expect(localVector("refund window")).toEqual(localVector("refund window"));
  });

  it("is unit length, so cosine similarity is a plain dot product", () => {
    const magnitude = Math.sqrt(localVector("refund window").reduce((s, v) => s + v * v, 0));

    expect(magnitude).toBeCloseTo(1, 10);
  });

  it("returns a zero vector for text with no usable tokens", () => {
    expect(localVector("!!! ?").every((value) => value === 0)).toBe(true);
  });

  it("discounts a term that appears in most of the corpus", () => {
    const corpus = ["refund rules", "refund timing", "refund limits", "warranty claims"];
    const idf = createIdf(corpus);
    const query = localVector("refund warranty", idf);
    const common = localVector("refund rules", idf);
    const rare = localVector("warranty claims", idf);

    expect(cosineSimilarity(query, rare)).toBeGreaterThan(cosineSimilarity(query, common));
  });

  it("scores related text above unrelated text", () => {
    const query = localVector("what is the refund window");
    const related = localVector("Refunds are accepted within 30 days of delivery.");
    const unrelated = localVector("Boot sizes run a half size small across the range.");

    expect(cosineSimilarity(query, related)).toBeGreaterThan(cosineSimilarity(query, unrelated));
  });
});
