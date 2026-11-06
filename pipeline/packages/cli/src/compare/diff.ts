/** Case-level comparison of two result sets. Pure. */

import type { CaseRecord, Metric, RunResult } from "@contextforge/shared";

export interface CasePair {
  readonly caseId: string;
  readonly baseline: CaseRecord;
  readonly candidate: CaseRecord;
}

/** Cases present on both sides, in the candidate's order. */
export function pairCases(baseline: RunResult, candidate: RunResult): CasePair[] {
  const byId = new Map(baseline.results.map((r) => [r.case_id, r]));
  const pairs: CasePair[] = [];
  for (const record of candidate.results) {
    const other = byId.get(record.case_id);
    if (other !== undefined)
      pairs.push({ caseId: record.case_id, baseline: other, candidate: record });
  }
  return pairs;
}

export interface PairedMeans {
  readonly baseline: number;
  readonly candidate: number;
  readonly count: number;
}

/**
 * Means over the cases scored on *both* sides. A case the candidate failed to
 * answer must not simply vanish from its average and flatter it.
 */
export function pairedMeans(pairs: readonly CasePair[], metric: Metric): PairedMeans | null {
  let base = 0;
  let cand = 0;
  let count = 0;
  for (const pair of pairs) {
    const b = pair.baseline.scores[metric];
    const c = pair.candidate.scores[metric];
    if (typeof b === "number" && typeof c === "number") {
      base += b;
      cand += c;
      count += 1;
    }
  }
  return count === 0 ? null : { baseline: base / count, candidate: cand / count, count };
}

export interface CaseRegression {
  readonly caseId: string;
  readonly reasons: string[];
}

function fmt(value: number): string {
  return value.toFixed(2);
}

/** Cases that got worse: the app stopped answering, or a metric fell by more than `caseDrop`. */
export function regressedCases(
  pairs: readonly CasePair[],
  metrics: readonly Metric[],
  caseDrop: number,
): CaseRegression[] {
  const regressions: CaseRegression[] = [];
  for (const pair of pairs) {
    const reasons: string[] = [];

    if (pair.candidate.status === "failed" && pair.baseline.status === "ok") {
      reasons.push(`the app failed to answer: ${pair.candidate.error ?? "unknown error"}`);
    }

    for (const metric of metrics) {
      const b = pair.baseline.scores[metric];
      const c = pair.candidate.scores[metric];
      // A tiny epsilon keeps float noise at exactly the threshold from flipping a case.
      if (typeof b === "number" && typeof c === "number" && b - c > caseDrop + 1e-9) {
        reasons.push(`${metric} fell from ${fmt(b)} to ${fmt(c)}`);
      }
    }

    if (reasons.length > 0) regressions.push({ caseId: pair.caseId, reasons });
  }
  return regressions;
}

/** How many scores the judge could not produce on a side, for the notes. */
export function unscoredCount(result: RunResult, metrics: readonly Metric[]): number {
  return result.results
    .filter((r) => r.status === "ok")
    .reduce(
      (n, r) => n + metrics.filter((m) => r.scores[m] === null || r.scores[m] === undefined).length,
      0,
    );
}
