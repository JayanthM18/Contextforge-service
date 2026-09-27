/**
 * `contextforge run --config <path> [--candidate HEAD] [--baseline <ref>] [--mode cached|dual]`
 *
 * The pull-request flow from docs/ARCHITECTURE.md: build the candidate, find
 * or build a baseline, score both, compare, write results.
 */

import path from "node:path";

import { EXIT_CODE, type ExitCode, type Mode, type RunResult } from "@contextforge/shared";

import { findStoredBenchmark, ANCESTOR_LIMIT } from "../benchmark/store.js";
import { decideBaseline } from "../benchmark/decide.js";
import { buildRunResult, writeJson } from "../compare/results.js";
import { compare } from "../compare/verdict.js";
import { ensureEvaluatorImage, type EvaluatorOptions } from "../evaluator/client.js";
import { buildFingerprint } from "../runner/fingerprint.js";
import { answerSide, scoreSide, type AnsweredSide } from "../runner/side.js";
import { assertDockerAvailable } from "../util/docker.js";
import { ContextForgeError } from "../util/errors.js";
import type { Git } from "../util/git.js";
import { prepare, short } from "./prepare.js";

export interface RunOptions extends EvaluatorOptions {
  readonly configPath: string;
  readonly candidate: string;
  readonly baseline?: string;
  readonly mode?: "cached" | "dual";
  readonly baseBranch: string;
  readonly outputDir: string;
  /** Query both sides and stop: no judge, no verdict. For checking the app side works. */
  readonly answersOnly: boolean;
  readonly fetch?: typeof fetch;
  readonly now?: () => Date;
}

export interface RunOutcome {
  readonly exitCode: ExitCode;
  readonly outputDir: string;
  readonly mode: Mode | "answers-only";
}

/** The base branch as the repository knows it: the remote-tracking ref if fetched, else the local one. */
export async function resolveBaseRef(git: Git, branch: string): Promise<string | null> {
  for (const candidate of [`origin/${branch}`, branch]) {
    try {
      await git.resolve(candidate);
      return candidate;
    } catch {
      // try the next form
    }
  }
  return null;
}

export async function runCommand(options: RunOptions): Promise<RunOutcome> {
  const ctx = await prepare({
    configPath: options.configPath,
    exec: options.exec,
    env: options.env,
    requireKeys: !options.answersOnly,
  });
  const { config, git } = ctx;
  const metrics = config.evaluation.metrics;
  const logger = options.logger;
  const notes: string[] = [];

  await assertDockerAvailable(options.exec, options.env);

  // --- which commits -------------------------------------------------------
  const candidateSha = await git.resolve(options.candidate);
  const inWorkingTree = options.candidate === "HEAD";
  const dirty = inWorkingTree && (await git.isDirty());
  const candidateLabel = dirty ? `${candidateSha}+dirty` : candidateSha;
  if (dirty) notes.push("the candidate includes uncommitted changes in the working tree");

  const baseRef = await resolveBaseRef(git, options.baseBranch);
  let baselineSha: string;
  if (options.baseline !== undefined) {
    baselineSha = await git.resolve(options.baseline);
  } else {
    if (baseRef === null) {
      throw new ContextForgeError(
        "GIT_FAILED",
        `Cannot find the base branch "${options.baseBranch}"`,
        {
          remedy:
            "Pass --baseline <ref>, or --base-branch with the branch pull requests merge into. In CI, fetch with fetch-depth: 0.",
        },
      );
    }
    baselineSha = await git.mergeBase(candidateSha, baseRef);
    logger.info("baseline is the merge base", { base: baseRef, merge_base: short(baselineSha) });
  }

  // --- the candidate is always built ----------------------------------------
  const sideOptions = {
    config,
    cases: ctx.dataset.cases,
    exec: options.exec,
    logger,
    env: options.env,
    composeFile: ctx.composeRel,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  };

  const answerAt = (
    role: "baseline" | "candidate",
    sha: string,
    working: boolean,
  ): Promise<AnsweredSide> =>
    working
      ? answerSide({ ...sideOptions, role, checkout: ctx.repoRoot })
      : git.withWorktree(sha, (checkout) => answerSide({ ...sideOptions, role, checkout }));

  const candidateSide = await answerAt("candidate", candidateSha, inWorkingTree);
  const currentFingerprint = (appHash: string) =>
    buildFingerprint(config, ctx.datasetHash, appHash);

  if (options.answersOnly) {
    const baselineSide = await answerAt("baseline", baselineSha, false);
    const note = "answers only: nothing was scored and no verdict was reached";
    const make = (commit: string, side: AnsweredSide): RunResult =>
      buildRunResult({
        commit,
        fingerprint: currentFingerprint(side.appHash),
        records: side.records,
        runs: 1,
        metrics: [],
        notes: [...notes, note],
        ...(options.now === undefined ? {} : { now: options.now() }),
      });
    await writeJson(path.join(options.outputDir, "baseline.json"), make(baselineSha, baselineSide));
    await writeJson(
      path.join(options.outputDir, "candidate.json"),
      make(candidateLabel, candidateSide),
    );
    logger.info("wrote answers for both sides", { output: options.outputDir });
    return { exitCode: EXIT_CODE.pass, outputDir: options.outputDir, mode: "answers-only" };
  }

  let image: string | undefined;
  const scorer = async () => (image ??= await ensureEvaluatorImage(options));
  const score = async (records: AnsweredSide["records"]) =>
    scoreSide(records, ctx.dataset.cases, config, await scorer(), options);

  // --- the baseline: stored, re-scored, or rebuilt --------------------------
  const requested = options.mode ?? config.baseline.mode;
  let mode: Mode = "dual";
  let baseline: RunResult | undefined;

  if (requested === "cached") {
    const stored = await findStoredBenchmark({
      git,
      logger,
      mergeBase: baselineSha,
      storeRel: ctx.storeRel,
      storeDir: ctx.storeDir,
      baseRef,
    });

    if (stored === null) {
      if (!config.baseline.rebuild_if_missing) {
        throw new ContextForgeError(
          "RESULTS_INVALID",
          `No stored benchmark for ${short(baselineSha)} or its ancestors`,
          {
            remedy:
              "Run `contextforge benchmark` on the base branch, or set baseline.rebuild_if_missing: true.",
          },
        );
      }
      notes.push(
        `no stored benchmark for ${short(baselineSha)} or its ${String(ANCESTOR_LIMIT)} nearest ancestors, so both sides were run`,
      );
    } else {
      if (stored.distance > 0) {
        notes.push(
          `the nearest stored benchmark is ${short(stored.sha)}, ${String(stored.distance)} commits before the merge base ${short(baselineSha)}`,
        );
      }
      const decision = decideBaseline(
        stored.result.fingerprint,
        currentFingerprint(candidateSide.appHash),
      );
      notes.push(decision.reason);
      mode = decision.mode;

      if (mode === "cached") baseline = stored.result;
      if (mode === "rejudged") {
        const blank = stored.result.results.map((r) => ({
          ...r,
          scores: {},
          scores_stddev: {},
          score_errors: {},
        }));
        baseline = buildRunResult({
          commit: stored.result.commit,
          fingerprint: currentFingerprint(stored.result.fingerprint.app_hash),
          records: await score(blank),
          runs: config.evaluation.runs,
          metrics,
          notes: [...stored.result.notes, "re-scored from stored answers"],
        });
      }
    }
  }

  if (baseline === undefined) {
    mode = "dual";
    const side = await answerAt("baseline", baselineSha, false);
    baseline = buildRunResult({
      commit: baselineSha,
      fingerprint: currentFingerprint(side.appHash),
      records: await score(side.records),
      runs: config.evaluation.runs,
      metrics,
    });
  }

  const candidate = buildRunResult({
    commit: candidateLabel,
    fingerprint: currentFingerprint(candidateSide.appHash),
    records: await score(candidateSide.records),
    runs: config.evaluation.runs,
    metrics,
    notes,
  });

  // --- verdict --------------------------------------------------------------
  const verdict = compare(baseline, candidate, config, mode, notes);
  await writeJson(path.join(options.outputDir, "baseline.json"), baseline);
  await writeJson(path.join(options.outputDir, "candidate.json"), candidate);
  await writeJson(path.join(options.outputDir, "results.json"), { verdict, baseline, candidate });

  logger.info(`verdict: ${verdict.status.toUpperCase()}`, {
    mode,
    regressed: verdict.regressed_cases.length,
    output: options.outputDir,
  });
  return {
    exitCode: verdict.status === "pass" ? EXIT_CODE.pass : EXIT_CODE.regression,
    outputDir: options.outputDir,
    mode,
  };
}
