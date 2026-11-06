/**
 * The noise floor (stage 6): compare a commit against itself several times
 * and see how far the scores move when nothing changed. Thresholds below this
 * spread would fail pull requests at random. Pure.
 *
 * This only *suggests* thresholds. A human decides, and records the
 * measurement and the judge that produced it in docs/MEMORY.md
 * (docs/DESIGN.md section 4).
 */

import type { Metric, ResultsFile } from "@contextforge/shared";

import { pairCases, pairedMeans } from "./diff.js";

export interface MetricNoise {
  readonly name: Metric;
  /** Mean and largest |candidate − baseline| of the metric's mean, across runs. */
  readonly meanAbsDelta: number;
  readonly maxAbsDelta: number;
  /** 95th percentile and largest single-case drop, across all runs and cases. */
  readonly caseDropP95: number;
  readonly caseDropMax: number;
}

export interface NoiseReport {
  readonly runs: number;
  /** Cases compared per run; one case flipping moves a mean by 1/cases. */
  readonly cases: number;
  readonly judge: string;
  readonly metrics: MetricNoise[];
  readonly suggested: {
    readonly mean_drop: Partial<Record<Metric, number>>;
    readonly case_drop: number;
  };
}

function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? 0;
}

/** Round up to the next hundredth, so a suggestion never sits below what was seen. */
function ceil2(value: number): number {
  return Math.ceil(value * 100 - 1e-9) / 100;
}

export function measureNoise(
  runs: readonly ResultsFile[],
  metrics: readonly Metric[],
): NoiseReport {
  const perMetric = metrics.map((name): MetricNoise => {
    const deltas: number[] = [];
    const drops: number[] = [];
    for (const run of runs) {
      const pairs = pairCases(run.baseline, run.candidate);
      const means = pairedMeans(pairs, name);
      if (means !== null) deltas.push(Math.abs(means.candidate - means.baseline));
      for (const pair of pairs) {
        const b = pair.baseline.scores[name];
        const c = pair.candidate.scores[name];
        if (typeof b === "number" && typeof c === "number") drops.push(Math.max(0, b - c));
      }
    }
    return {
      name,
      meanAbsDelta: deltas.length === 0 ? 0 : deltas.reduce((s, v) => s + v, 0) / deltas.length,
      maxAbsDelta: deltas.length === 0 ? 0 : Math.max(...deltas),
      caseDropP95: percentile(drops, 95),
      caseDropMax: drops.length === 0 ? 0 : Math.max(...drops),
    };
  });

  // Scores move in chunks: one case flipping from 1 to 0 moves a mean over N
  // cases by 1/N. A threshold below that fails a pull request on a single
  // flip, however quiet the measurement was, so drift alone is not enough.
  // Measured with a real judge, five self-comparisons drifted by exactly 0,
  // and drift-only suggestions of 0.02 would have been below one flip (0.029).
  const cases = runs[0] === undefined ? 0 : pairCases(runs[0].baseline, runs[0].candidate).length;
  const oneFlip = cases === 0 ? 0 : 1 / cases;

  // Mean thresholds: half again the larger of the drift seen and one flip.
  const mean_drop: Partial<Record<Metric, number>> = {};
  for (const m of perMetric) {
    mean_drop[m.name] = Math.max(0.02, ceil2(Math.max(m.maxAbsDelta, oneFlip) * 1.5));
  }

  // Case threshold: above the 95th-percentile case drop, and never below
  // 0.30. A typical answer holds about three statements, so one statement
  // changing its verdict moves that case's faithfulness by about 0.33; below
  // 0.30 even a wording change in one answer marks the case regressed. The
  // rarer, larger swings are what max_regressed_cases absorbs.
  const case_drop = Math.min(
    1,
    Math.max(0.3, ceil2(Math.max(...perMetric.map((m) => m.caseDropP95), 0) * 1.2)),
  );

  return {
    runs: runs.length,
    cases,
    judge: runs[0]?.verdict.judge_model ?? "unknown",
    metrics: perMetric,
    suggested: { mean_drop, case_drop },
  };
}
