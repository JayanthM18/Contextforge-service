/** Baseline reuse is permitted only for an exact fingerprint match. */

import type { Fingerprint } from "@contextforge/shared";
import { describe, expect, it } from "vitest";

import { decideBaseline } from "../src/benchmark/decide.js";
import { FINGERPRINT } from "./fixtures.js";

const with_ = (changes: Partial<Fingerprint>): Fingerprint => ({ ...FINGERPRINT, ...changes });

describe("decideBaseline", () => {
  it("reuses scores for an exact fingerprint match", () => {
    expect(decideBaseline(FINGERPRINT, FINGERPRINT)).toMatchObject({ mode: "cached" });
  });

  it.each([
    ["dataset", { dataset_hash: "sha256:new" }],
    ["app environment", { app_hash: "sha256:new" }],
    ["judge", { judge: { ...FINGERPRINT.judge, model: "qwen3:14b" } }],
    ["embedding model", { embeddings: { model: "nomic-embed-text" } }],
    ["tool version", { tool_version: "0.2.0" }],
  ] as const)("rebuilds the baseline when the %s fingerprint changes", (_name, changes) => {
    const decision = decideBaseline(FINGERPRINT, with_(changes));

    expect(decision.mode).toBe("dual");
    expect(decision.reason).toContain("fingerprint changed");
  });
});
