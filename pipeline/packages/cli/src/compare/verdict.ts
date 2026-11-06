/** The verdict from two result sets (docs/DESIGN.md section 4). Pure. */

import type { Mode, RunResult, Verdict } from "@contextforge/shared";

import type { Config } from "../config/schema.js";
import { ContextForgeError } from "../util/errors.js";
import { pairCases, pairedMeans, regressedCases, unscoredCount } from "./diff.js";
import { evaluateMetric } from "./thresholds.js";

/** Two results that were not produced against the same exam and judge cannot be compared. */
export function assertComparable(baseline: RunResult, candidate: RunResult): void {
  const a = baseline.fingerprint;
  const b = candidate.fingerprint;
  if (a.dataset_hash !== b.dataset_hash) {
    throw new ContextForgeError(
      "RESULTS_INVALID",
      "The two results were produced from different test sets",
      {
        remedy:
          "Comparing scores across a changed test set is meaningless. Re-run both sides on the same dataset.",
      },
    );
  }
  if (
    a.judge.model !== b.judge.model ||
    a.judge.temperature !== b.judge.temperature ||
    a.judge.seed !== b.judge.seed ||
    a.judge.reasoning_effort !== b.judge.reasoning_effort ||
    (a.embeddings?.model ?? null) !== (b.embeddings?.model ?? null)
  ) {
    throw new ContextForgeError(
      "RESULTS_INVALID",
      "The two results were scored by different judges",
      {
        remedy: "Rebuild and score both results with the same judge before comparing.",
      },
    );
  }
}

export function compare(
  baseline: RunResult,
  candidate: RunResult,
  config: Config,
  mode: Mode,
  extraNotes: readonly string[] = [],
): Verdict {
  assertComparable(baseline, candidate);

  const metrics = config.evaluation.metrics;
  const pairs = pairCases(baseline, candidate);
  const { mean_drop: meanDrop, absolute_floor: floor, case_drop: caseDrop } = config.thresholds;

  const metricVerdicts = metrics.map((metric) =>
    evaluateMetric(metric, pairedMeans(pairs, metric), candidate.summary[metric] ?? null, {
      ...(meanDrop[metric] === undefined ? {} : { meanDrop: meanDrop[metric] }),
      ...(floor[metric] === undefined ? {} : { floor: floor[metric] }),
    }),
  );

  const regressions = regressedCases(pairs, metrics, caseDrop);
  const tooMany = regressions.length > config.thresholds.max_regressed_cases;
  const failed = metricVerdicts.some((m) => m.status === "fail") || tooMany;

  const notes: string[] = [...extraNotes];
  notes.push(
    `${String(regressions.length)} of ${String(pairs.length)} cases regressed ` +
      `(${tooMany ? "more than" : "within"} the limit of ${String(config.thresholds.max_regressed_cases)})`,
  );
  const failedCandidate = candidate.results.filter((r) => r.status === "failed").length;
  const failedBaseline = baseline.results.filter((r) => r.status === "failed").length;
  if (failedCandidate > 0)
    notes.push(`the candidate app failed to answer ${count(failedCandidate, "case")}`);
  if (failedBaseline > 0)
    notes.push(`the baseline app failed to answer ${count(failedBaseline, "case")}`);
  const unscored = unscoredCount(candidate, metrics) + unscoredCount(baseline, metrics);
  if (unscored > 0)
    notes.push(
      `${count(unscored, "score")} could not be computed by the judge and ${unscored === 1 ? "was" : "were"} excluded`,
    );
  const missing = baseline.results.length + candidate.results.length - 2 * pairs.length;
  if (missing > 0)
    notes.push(
      `${count(missing, "case")} ${missing === 1 ? "appears" : "appear"} on only one side and ${missing === 1 ? "was" : "were"} not compared`,
    );

  return {
    status: failed ? "fail" : "pass",
    mode,
    baseline_commit: baseline.commit,
    candidate_commit: candidate.commit,
    judge_model: candidate.fingerprint.judge.model,
    metrics: metricVerdicts,
    regressed_cases: regressions.map((r) => r.caseId),
    regressions: regressions.map((r) => ({ case_id: r.caseId, reasons: r.reasons })),
    notes,
  };
}

/** "1 case", "3 cases". */
function count(n: number, noun: string): string {
  return `${String(n)} ${noun}${n === 1 ? "" : "s"}`;
}
