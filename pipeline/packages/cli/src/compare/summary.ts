/** Per-metric means over the cases that produced a score. Pure. */

import type { CaseRecord, Metric, ScoreMap } from "@contextforge/shared";

export function summarise(records: readonly CaseRecord[], metrics: readonly Metric[]): ScoreMap {
  const summary: ScoreMap = {};
  for (const metric of metrics) {
    const values = records
      .map((record) => record.scores[metric])
      .filter((v): v is number => typeof v === "number");
    summary[metric] =
      values.length === 0 ? null : values.reduce((s, v) => s + v, 0) / values.length;
  }
  return summary;
}
