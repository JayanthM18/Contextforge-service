/**
 * One side of a comparison — baseline or candidate — from source checkout to
 * scored results.
 */

import path from "node:path";

import type { CaseRecord, TestCase } from "@contextforge/shared";

import type { Config } from "../config/schema.js";
import { applyScores } from "../evaluator/aggregate.js";
import { buildScoreRequest, scoreCases, type EvaluatorOptions } from "../evaluator/client.js";
import type { ScoreResponse } from "../evaluator/types.js";
import { isContextForgeError } from "../util/errors.js";
import type { Exec } from "../util/exec.js";
import type { Logger } from "../util/logger.js";
import { ComposeProject, composeEnv, projectName } from "./compose.js";
import { appHash } from "./fingerprint.js";
import { waitForHealthy } from "./health.js";
import { queryAll } from "./query.js";

export interface AnswerOptions {
  readonly role: "baseline" | "candidate";
  /** Root of the checkout holding this side's source. */
  readonly checkout: string;
  /** The compose file, relative to the repository root. */
  readonly composeFile: string;
  readonly config: Config;
  readonly cases: readonly TestCase[];
  readonly exec: Exec;
  readonly logger: Logger;
  readonly env: Record<string, string | undefined>;
  readonly fetch?: typeof fetch;
  /** Overridable so tests need not wait on real time. */
  readonly healthIntervalMs?: number;
}

export interface AnsweredSide {
  readonly records: CaseRecord[];
  readonly appHash: string;
}

/**
 * Build and start the app, wait for health, ask every question, and tear the
 * app down whatever happened. A container left running after a failure would
 * hold the port and poison the next run.
 */
export async function answerSide(options: AnswerOptions): Promise<AnsweredSide> {
  const logger = options.logger.child({ side: options.role });
  const composeFile = path.join(options.checkout, options.composeFile);
  const hash = await appHash(composeFile);

  const compose = new ComposeProject({
    exec: options.exec,
    logger,
    composeFile,
    service: options.config.app.service,
    cwd: path.dirname(composeFile),
    env: composeEnv(options.env, options.config.app.env_passthrough),
    projectName: projectName(options.role),
  });

  const { app } = options.config;
  const baseUrl = `http://127.0.0.1:${String(app.port)}`;

  try {
    logger.info("building and starting the app", { service: app.service });
    await compose.up();

    try {
      await waitForHealthy({
        url: `${baseUrl}${app.health_path}`,
        timeoutMs: app.startup_timeout * 1000,
        isRunning: () => compose.isRunning(),
        ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
        ...(options.healthIntervalMs === undefined ? {} : { intervalMs: options.healthIntervalMs }),
      });
    } catch (error: unknown) {
      if (isContextForgeError(error)) {
        const logs = await compose.logs();
        error.remedy = `${error.remedy ?? ""}\n--- last log lines from ${app.service} ---\n${logs}`;
      }
      throw error;
    }

    logger.info("app is healthy; asking every question", { cases: options.cases.length });
    const records = await queryAll(options.cases, {
      baseUrl,
      queryPath: app.query_path,
      timeoutMs: app.query_timeout * 1000,
      logger,
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    });
    return { records, appHash: hash };
  } finally {
    logger.info("tearing down the app");
    await compose.down();
  }
}

/** Score a side's answered cases `runs` times and fold the passes together. */
export async function scoreSide(
  records: readonly CaseRecord[],
  cases: readonly TestCase[],
  config: Config,
  image: string,
  options: EvaluatorOptions,
): Promise<CaseRecord[]> {
  const truth = new Map(cases.map((c) => [c.id, c.ground_truth]));

  const answered = records
    .filter((r) => r.status === "ok")
    .map((r) => ({
      case_id: r.case_id,
      question: r.question,
      ground_truth: truth.get(r.case_id) ?? "",
      answer: r.answer ?? "",
      contexts: r.contexts.map((c) => c.text),
    }));

  const request = buildScoreRequest(config, answered);
  const passes: ScoreResponse[] = [];
  for (let run = 1; run <= config.evaluation.runs; run += 1) {
    if (config.evaluation.runs > 1)
      options.logger.info("scoring pass", { run, of: config.evaluation.runs });
    passes.push(await scoreCases(image, request, options));
  }
  return applyScores(records, passes, config.evaluation.metrics);
}
