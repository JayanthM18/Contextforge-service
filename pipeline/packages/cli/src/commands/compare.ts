/** `contextforge compare <baseline.json> <candidate.json> --config <path>` */

import { EXIT_CODE, type ExitCode } from "@contextforge/shared";

import { loadConfig } from "../config/load.js";
import { pairCases, regressedCases } from "../compare/diff.js";
import { readRunResult, writeJson } from "../compare/results.js";
import { compare } from "../compare/verdict.js";
import type { Logger } from "../util/logger.js";

export interface CompareOptions {
  readonly baselinePath: string;
  readonly candidatePath: string;
  readonly configPath: string;
  readonly outputPath?: string;
  readonly logger: Logger;
  readonly env: Record<string, string | undefined>;
  readonly stdout?: (text: string) => void;
}

function fmt(value: number | null): string {
  return value === null ? "  n/a" : value.toFixed(3);
}

export async function compareCommand(options: CompareOptions): Promise<ExitCode> {
  // Comparing stored files needs neither the dataset nor a judge key.
  const config = await loadConfig({
    configPath: options.configPath,
    requireDataset: false,
    requireKeys: false,
    env: options.env,
  });
  const [baseline, candidate] = await Promise.all([
    readRunResult(options.baselinePath),
    readRunResult(options.candidatePath),
  ]);

  const verdict = compare(baseline, candidate, config, "dual", [
    "compared two supplied result files",
  ]);

  for (const metric of verdict.metrics) {
    options.logger.info(`${metric.status.toUpperCase().padEnd(7)} ${metric.name}`, {
      baseline: fmt(metric.baseline),
      candidate: fmt(metric.candidate),
      delta: fmt(metric.delta),
      ...(metric.reasons.length > 0 ? { why: metric.reasons.join("; ") } : {}),
    });
  }
  const pairs = pairCases(baseline, candidate);
  for (const regression of regressedCases(
    pairs,
    config.evaluation.metrics,
    config.thresholds.case_drop,
  )) {
    options.logger.warn(`regressed ${regression.caseId}`, { why: regression.reasons.join("; ") });
  }
  for (const note of verdict.notes) options.logger.info(note);
  options.logger.info(`verdict: ${verdict.status.toUpperCase()}`);

  if (options.outputPath !== undefined) {
    await writeJson(options.outputPath, { verdict, baseline, candidate });
  }
  (options.stdout ?? ((text: string) => process.stdout.write(text)))(
    `${JSON.stringify(verdict, null, 2)}\n`,
  );

  return verdict.status === "pass" ? EXIT_CODE.pass : EXIT_CODE.regression;
}
