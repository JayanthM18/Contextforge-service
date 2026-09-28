/** Every branch of the cached-mode decision (the stage 7 gate). */

import type { Fingerprint } from "@contextforge/shared";
import { describe, expect, it } from "vitest";

import { decideBaseline } from "../src/benchmark/decide.js";
import { FINGERPRINT } from "./fixtures.js";

const with_ = (changes: Partial<Fingerprint>): Fingerprint => ({ ...FINGERPRINT, ...changes });

describe("decideBaseline", () => {
  it("nothing differs → use the stored scores", () => {
    expect(decideBaseline(FINGERPRINT, FINGERPRINT)).toMatchObject({ mode: "cached" });
  });

  it("judge model differs → re-score the stored answers", () => {
    const decision = decideBaseline(
      FINGERPRINT,
      with_({ judge: { ...FINGERPRINT.judge, model: "qwen3:14b" } }),
    );

    expect(decision.mode).toBe("rejudged");
    expect(decision.reason).toContain("judge");
  });

  it("judge temperature or seed differs → re-score", () => {
    expect(
      decideBaseline(FINGERPRINT, with_({ judge: { ...FINGERPRINT.judge, seed: 7 } })).mode,
    ).toBe("rejudged");
    expect(
      decideBaseline(FINGERPRINT, with_({ judge: { ...FINGERPRINT.judge, temperature: 0.2 } }))
        .mode,
    ).toBe("rejudged");
  });

  it("reasoning effort differs → re-score, since thinking changes the verdicts", () => {
    expect(
      decideBaseline(
        FINGERPRINT,
        with_({ judge: { ...FINGERPRINT.judge, reasoning_effort: "none" } }),
      ).mode,
    ).toBe("rejudged");
  });

  it("embedding model differs → re-score, and says which", () => {
    const decision = decideBaseline(
      FINGERPRINT,
      with_({ embeddings: { model: "nomic-embed-text" } }),
    );

    expect(decision.mode).toBe("rejudged");
    expect(decision.reason).toContain("embedding model");
  });

  it("embeddings added or removed → re-score", () => {
    expect(decideBaseline(FINGERPRINT, with_({ embeddings: null })).mode).toBe("rejudged");
  });

  it("dataset hash differs → dual", () => {
    const decision = decideBaseline(FINGERPRINT, with_({ dataset_hash: "sha256:new" }));

    expect(decision.mode).toBe("dual");
    expect(decision.reason).toContain("test set changed");
  });

  it("app hash differs → dual", () => {
    expect(decideBaseline(FINGERPRINT, with_({ app_hash: "sha256:new" }))).toMatchObject({
      mode: "dual",
    });
  });

  it("tool major version differs → dual", () => {
    expect(decideBaseline(FINGERPRINT, with_({ tool_version: "1.0.0" })).mode).toBe("dual");
  });

  it("tool minor or patch version differs → still usable", () => {
    expect(decideBaseline(FINGERPRINT, with_({ tool_version: "0.9.3" })).mode).toBe("cached");
  });

  it("a rebuild reason wins over a re-score reason", () => {
    const decision = decideBaseline(
      FINGERPRINT,
      with_({ dataset_hash: "sha256:new", judge: { ...FINGERPRINT.judge, model: "other" } }),
    );

    expect(decision.mode).toBe("dual");
  });
});
