import { describe, expect, it } from "vitest";

import { ConfigError, loadConfig } from "../src/config.ts";

const local = { PROVIDER: "local" };

describe("loadConfig", () => {
  it("defaults to the openai provider and the documented model names", () => {
    const config = loadConfig({ OPENAI_API_KEY: "sk-test" });

    expect(config.provider).toBe("openai");
    expect(config.embeddingModel).toBe("text-embedding-3-small");
    expect(config.generationModel).toBe("gpt-4o-mini");
    expect(config.port).toBe(8000);
    expect(config.topK).toBe(5);
  });

  it("uses Gemini defaults and requires its API key", () => {
    const config = loadConfig({ PROVIDER: "gemini", GEMINI_API_KEY: "test-key" });

    expect(config.provider).toBe("gemini");
    expect(config.embeddingModel).toBe("gemini-embedding-001");
    expect(config.generationModel).toBe("gemini-3.8-flash");
    expect(config.apiBaseUrl).toBe("https://generativelanguage.googleapis.com/v1beta/openai");
    expect(() => loadConfig({ PROVIDER: "gemini" })).toThrow(/GEMINI_API_KEY/);
  });

  it("names the missing variable when openai has no key", () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => loadConfig({})).toThrow(/OPENAI_API_KEY/);
  });

  it("points at the offline provider as the way out", () => {
    expect(() => loadConfig({})).toThrow(/PROVIDER=local/);
  });

  it("needs no key for the local provider", () => {
    expect(loadConfig(local).provider).toBe("local");
  });

  it("rejects an unknown provider by name", () => {
    expect(() => loadConfig({ PROVIDER: "cohere" })).toThrow(/PROVIDER.*"cohere"/);
  });

  it("rejects a non-integer number and shows what it was given", () => {
    expect(() => loadConfig({ ...local, TOP_K: "five" })).toThrow(/TOP_K.*"five"/);
  });

  it("rejects a number outside its range", () => {
    expect(() => loadConfig({ ...local, PORT: "0" })).toThrow(/PORT must be between 1 and 65535/);
    expect(() => loadConfig({ ...local, TOP_K: "99" })).toThrow(/TOP_K must be between 1 and 50/);
  });

  it("refuses an overlap that would stop chunking making progress", () => {
    expect(() => loadConfig({ ...local, CHUNK_SIZE: "500", CHUNK_OVERLAP: "500" })).toThrow(
      /CHUNK_OVERLAP \(500\) must be smaller than CHUNK_SIZE \(500\)/,
    );
  });

  it("treats an empty string as unset, because Compose passes empty for unset", () => {
    expect(loadConfig({ ...local, TOP_K: "" }).topK).toBe(5);
  });

  it("leaves reasoning effort unset by default, since most models reject it", () => {
    expect(loadConfig(local).reasoningEffort).toBeNull();
  });

  it("accepts a known reasoning effort and names a bad one", () => {
    expect(loadConfig({ ...local, REASONING_EFFORT: "none" }).reasoningEffort).toBe("none");
    expect(() => loadConfig({ ...local, REASONING_EFFORT: "max" })).toThrow(
      /REASONING_EFFORT.*"max"/,
    );
  });

  it("takes overrides from the environment", () => {
    const config = loadConfig({ ...local, PORT: "9100", TOP_K: "3", CHUNK_SIZE: "400" });

    expect(config.port).toBe(9100);
    expect(config.topK).toBe(3);
    expect(config.chunkSize).toBe(400);
  });
});
