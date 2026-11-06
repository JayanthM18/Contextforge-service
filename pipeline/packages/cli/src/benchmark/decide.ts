/**
 * The baseline is either reusable as-is or rebuilt. A changed judge is not a
 * separate execution path: its fingerprint makes the stored benchmark stale.
 */

import type { Fingerprint, Mode } from "@contextforge/shared";

export interface Decision {
  readonly mode: Mode;
  /** Why, in words the report can show. No silent fallbacks. */
  readonly reason: string;
}

export function decideBaseline(stored: Fingerprint, current: Fingerprint): Decision {
  if (
    stored.dataset_hash === current.dataset_hash &&
    stored.app_hash === current.app_hash &&
    stored.judge.model === current.judge.model &&
    stored.judge.temperature === current.judge.temperature &&
    stored.judge.seed === current.judge.seed &&
    stored.judge.reasoning_effort === current.judge.reasoning_effort &&
    (stored.embeddings?.model ?? null) === (current.embeddings?.model ?? null) &&
    stored.tool_version === current.tool_version
  ) {
    return { mode: "cached", reason: "the stored benchmark matched; its scores were reused" };
  }

  return {
    mode: "dual",
    reason: "the stored benchmark fingerprint changed, so the merge-base app was rebuilt and scored",
  };
}
