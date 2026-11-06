import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createIdf,
  createEmbedder,
  documentFrequencies,
  localVector,
  stem,
  tokenise,
} from "../src/embed.ts";
import { loadConfig } from "../src/config.ts";
import { cosineSimilarity } from "../src/retrieve.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

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

  describe("Gemini embeddings", () => {
    it("uses the native batch API with the query/document task type and Gemini key", async () => {
      const fetcher = vi.fn<typeof globalThis.fetch>(() =>
        Promise.resolve(
          new Response(JSON.stringify({ embeddings: [{ values: [0.2, 0.8] }] }), { status: 200 }),
        ),
      );
      vi.stubGlobal("fetch", fetcher);
      const config = loadConfig({ PROVIDER: "gemini", GEMINI_API_KEY: "gemini-test-key" });
      const embedder = createEmbedder(config, []);

      await expect(embedder.embed(["hello"], "RETRIEVAL_QUERY")).resolves.toEqual([[0.2, 0.8]]);

      const [url, init] = fetcher.mock.calls[0] ?? [];
      expect(url).toBe(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents",
      );
      expect(new Headers(init?.headers).get("x-goog-api-key")).toBe("gemini-test-key");
      if (typeof init?.body !== "string") throw new Error("expected a JSON request body");
      expect(JSON.parse(init.body)).toEqual({
        requests: [
          {
            model: "models/gemini-embedding-001",
            content: { parts: [{ text: "hello" }] },
            taskType: "RETRIEVAL_QUERY",
          },
        ],
      });
    });

    it("rejects malformed vectors instead of passing them to retrieval", async () => {
      vi.stubGlobal("fetch", () =>
        Promise.resolve(new Response(JSON.stringify({ embeddings: [{ values: ["bad"] }] }))),
      );
      const config = loadConfig({ PROVIDER: "gemini", GEMINI_API_KEY: "gemini-test-key" });

      await expect(createEmbedder(config, []).embed(["hello"])).rejects.toThrow(
        "Gemini embedding response vector 0 is invalid",
      );
    });

    it("batches Gemini requests without changing vector order", async () => {
      const fetcher = vi.fn<typeof globalThis.fetch>((_input, init) => {
        if (typeof init?.body !== "string") throw new Error("expected a JSON request body");
        const { requests } = JSON.parse(init.body) as {
          requests: { content: { parts: { text: string }[] } }[];
        };
        return Promise.resolve(
          new Response(
            JSON.stringify({
              embeddings: requests.map(({ content }, index) => ({
                values: [Number(content.parts[0]?.text.split(" ")[1] ?? index)],
              })),
            }),
            { status: 200 },
          ),
        );
      });
      vi.stubGlobal("fetch", fetcher);
      const config = loadConfig({ PROVIDER: "gemini", GEMINI_API_KEY: "test-key" });
      const texts = Array.from({ length: 101 }, (_, index) => `document ${String(index)}`);
      const vectors = await createEmbedder(config, []).embed(texts);

      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(vectors).toHaveLength(101);
      expect(vectors[0]).toEqual([0]);
      expect(vectors[100]).toEqual([100]);
    });
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
