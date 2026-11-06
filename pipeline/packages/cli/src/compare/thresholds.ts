/** Applying `mean_drop` and `absolute_floor` to one metric. Pure. */

import type { Metric, MetricVerdict } from "@contextforge/shared";

import type { PairedMeans } from "./diff.js";

export interface MetricThresholds {
  readonly meanDrop?: number;
  readonly floor?: number;
}

function fmt(value: number): string {
  return value.toFixed(3);
}

export function evaluateMetric(
  name: Metric,
  paired: PairedMeans | null,
  candidateMean: number | null,
  thresholds: MetricThresholds,
): MetricVerdict {
  const reasons: string[] = [];
  let failed = false;
  const hasThreshold = thresholds.meanDrop !== undefined || thresholds.floor !== undefined;

  if (paired === null && candidateMean === null) {
    return {
      name,
      baseline: null,
      candidate: null,
      delta: null,
      threshold: thresholds.meanDrop === undefined ? null : -thresholds.meanDrop,
      floor: thresholds.floor ?? null,
      // Silence is not a pass: a gated metric that could not be measured fails.
      status: hasThreshold ? "fail" : "skipped",
      reasons: ["no case was scored on this metric"],
    };
  }

  const delta = paired === null ? null : paired.candidate - paired.baseline;

  if (thresholds.meanDrop !== undefined) {
    if (delta === null) {
      failed = true;
      reasons.push("no case was scored on both sides, so the drop cannot be measured");
    } else if (delta < -thresholds.meanDrop - 1e-9) {
      failed = true;
      reasons.push(
        `mean fell by ${fmt(-delta)}, more than the allowed ${fmt(thresholds.meanDrop)}`,
      );
    }
  }

  if (thresholds.floor !== undefined) {
    if (candidateMean === null) {
      failed = true;
      reasons.push("no candidate score to hold against the floor");
    } else if (candidateMean < thresholds.floor - 1e-9) {
      failed = true;
      reasons.push(
        `candidate mean ${fmt(candidateMean)} is below the floor of ${fmt(thresholds.floor)}`,
      );
    }
  }

  return {
    name,
    baseline: paired?.baseline ?? null,
    candidate: paired?.candidate ?? candidateMean,
    delta,
    threshold: thresholds.meanDrop === undefined ? null : -thresholds.meanDrop,
    floor: thresholds.floor ?? null,
    status: failed ? "fail" : "pass",
    reasons,
  };
}
