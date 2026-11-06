import { describe, expect, it } from "vitest";

import { ContextForgeError, isContextForgeError } from "../src/util/errors.js";

describe("ContextForgeError", () => {
  it("carries a machine-readable code alongside the human message", () => {
    const error = new ContextForgeError("CONFIG_INVALID", "thresholds.mean_drop: unknown metric");

    expect(error.code).toBe("CONFIG_INVALID");
    expect(error.message).toBe("thresholds.mean_drop: unknown metric");
    expect(error).toBeInstanceOf(Error);
  });

  it("formats the remedy on its own line so the user knows what to do next", () => {
    const error = new ContextForgeError("CONFIG_INVALID", "unknown key: judge_model", {
      remedy: "Move it under evaluation.judge.model.",
    });

    expect(error.format()).toBe(
      "[CONFIG_INVALID] unknown key: judge_model\n  → Move it under evaluation.judge.model.",
    );
  });

  it("omits the remedy line when there is none", () => {
    const error = new ContextForgeError("INTERNAL", "unreachable");

    expect(error.format()).toBe("[INTERNAL] unreachable");
  });

  it("keeps the underlying cause", () => {
    const cause = new Error("ENOENT");
    const error = new ContextForgeError("CONFIG_INVALID", "cannot read contextforge.yml", {
      cause,
    });

    expect(error.cause).toBe(cause);
  });

  it("narrows unknown values", () => {
    expect(isContextForgeError(new ContextForgeError("INTERNAL", "x"))).toBe(true);
    expect(isContextForgeError(new Error("x"))).toBe(false);
    expect(isContextForgeError("x")).toBe(false);
  });
});
