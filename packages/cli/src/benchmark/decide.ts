/**
 * Cached mode's one decision: given a stored benchmark's fingerprint and the
 * current one, reuse the stored scores, re-score the stored answers, or run
 * both sides from scratch (docs/DESIGN.md section 3). Pure, and every branch
 * is tested.
 */

import type { Fingerprint, Mode } from "@contextforge/shared";

export interface Decision {
  readonly mode: Mode;
  /** Why, in words the report can show. No silent fallbacks. */
  readonly reason: string;
}

function major(version: string): string {
  return version.split(".")[0] ?? version;
}

export function decideBaseline(stored: Fingerprint, current: Fingerprint): Decision {
  // Anything that invalidates the stored *answers* forces a rebuild, and is
  // checked first: re-scoring answers from a different exam or a different
  // environment would be precise and meaningless.
  if (stored.dataset_hash !== current.dataset_hash) {
    return {
      mode: "dual",
      reason:
        "the test set changed since the benchmark was stored, so its answers are for different questions",
    };
  }
  if (stored.app_hash !== current.app_hash) {
    return {
      mode: "dual",
      reason:
        "the app environment changed (Compose file, Dockerfile or a lockfile), so both sides were rebuilt",
    };
  }
  if (major(stored.tool_version) !== major(current.tool_version)) {
    return {
      mode: "dual",
      reason: `the benchmark was stored by ContextForge ${stored.tool_version}; this is ${current.tool_version}, a different major version`,
    };
  }

  const judgeChanged =
    stored.judge.model !== current.judge.model ||
    stored.judge.temperature !== current.judge.temperature ||
    stored.judge.seed !== current.judge.seed;
  const embeddingsChanged =
    (stored.embeddings?.model ?? null) !== (current.embeddings?.model ?? null);

  if (judgeChanged || embeddingsChanged) {
    const what = [judgeChanged ? "judge" : null, embeddingsChanged ? "embedding model" : null]
      .filter((x): x is string => x !== null)
      .join(" and ");
    return {
      mode: "rejudged",
      reason: `the ${what} changed, so the stored answers were re-scored rather than rebuilt`,
    };
  }

  return { mode: "cached", reason: "the stored benchmark matched; its scores were reused" };
}
