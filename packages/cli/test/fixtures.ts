/** Builders for run results, so comparator tests state only what they vary. */

import type { CaseRecord, Fingerprint, Metric, RunResult, ScoreMap } from "@contextforge/shared";

import { summarise } from "../src/compare/summary.js";

export const METRICS: Metric[] = [
  "context_precision",
  "context_recall",
  "faithfulness",
  "answer_relevancy",
];

export const FINGERPRINT: Fingerprint = {
  dataset_hash: "sha256:dataset",
  app_hash: "sha256:app",
  judge: { model: "gpt-4o-mini", temperature: 0, seed: 42 },
  embeddings: { model: "text-embedding-3-small" },
  tool_version: "0.1.0",
};

export function record(
  caseId: string,
  scores: ScoreMap,
  overrides: Partial<CaseRecord> = {},
): CaseRecord {
  return {
    case_id: caseId,
    question: `question ${caseId}?`,
    status: "ok",
    error: null,
    answer: `answer to ${caseId}`,
    contexts: [{ id: `${caseId}.md#c1`, text: "context" }],
    scores,
    scores_stddev: {},
    score_errors: {},
    latency_ms: 100,
    ...overrides,
  };
}

/** Every metric at the same value. */
export function all(value: number | null): ScoreMap {
  return Object.fromEntries(METRICS.map((m) => [m, value]));
}

export function result(
  records: CaseRecord[],
  overrides: Partial<RunResult> & { fingerprint?: Partial<Fingerprint> } = {},
): RunResult {
  const { fingerprint, ...rest } = overrides;
  return {
    commit: "abc1234",
    created_at: "2026-09-27T00:00:00Z",
    fingerprint: { ...FINGERPRINT, ...fingerprint },
    runs: 1,
    results: records,
    summary: summarise(records, METRICS),
    notes: [],
    ...rest,
  };
}
