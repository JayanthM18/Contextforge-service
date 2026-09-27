/**
 * Folding one or more scoring passes into case records. With `runs > 1` the
 * same answers are scored repeatedly and the mean and spread are kept, since
 * the judge itself is noisy (docs/DESIGN.md section 4).
 */

import type { CaseRecord, Metric, ScoreMap } from "@contextforge/shared";

import type { ScoreResponse } from "./types.js";

export const APP_DID_NOT_ANSWER = "the app did not answer this case, so there was nothing to score";

function mean(values: readonly number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Population standard deviation: the spread of these runs, not an estimate. */
function stddev(values: readonly number[]): number {
  const m = mean(values);
  return Math.sqrt(mean(values.map((v) => (v - m) ** 2)));
}

export function applyScores(
  records: readonly CaseRecord[],
  passes: readonly ScoreResponse[],
  metrics: readonly Metric[],
): CaseRecord[] {
  const byPass = passes.map((pass) => new Map(pass.results.map((r) => [r.case_id, r])));

  return records.map((record) => {
    const scores: ScoreMap = {};
    const spread: ScoreMap = {};
    const errors: Partial<Record<Metric, string>> = {};

    for (const metric of metrics) {
      if (record.status === "failed") {
        scores[metric] = null;
        spread[metric] = null;
        errors[metric] = APP_DID_NOT_ANSWER;
        continue;
      }

      const outcomes = byPass.map((pass) => pass.get(record.case_id));
      const values = outcomes
        .map((o) => o?.scores[metric])
        .filter((v): v is number => typeof v === "number");

      if (values.length === 0) {
        scores[metric] = null;
        spread[metric] = null;
        errors[metric] =
          outcomes.map((o) => o?.errors[metric]).find((e) => e !== undefined) ??
          "no score was returned";
        continue;
      }

      scores[metric] = mean(values);
      spread[metric] = values.length > 1 ? stddev(values) : null;
      if (values.length < passes.length) {
        errors[metric] = `scored in ${String(values.length)} of ${String(passes.length)} runs`;
      }
    }

    return { ...record, scores, scores_stddev: spread, score_errors: errors };
  });
}
