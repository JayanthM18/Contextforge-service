/**
 * `contextforge benchmark --config <path>`
 *
 * The local developer flow: build the app at HEAD,
 * score it, and store the result as `benchmark/baseline/<sha>.json` for local
 * comparisons. Hosted baseline storage belongs to the ContextForge service.
 */

import { storeFile } from "../benchmark/store.js";
import { buildRunResult, writeJson } from "../compare/results.js";
import { ensureEvaluatorImage, type EvaluatorOptions } from "../evaluator/client.js";
import { buildFingerprint } from "../runner/fingerprint.js";
import { answerSide, scoreSide } from "../runner/side.js";
import { assertDockerAvailable } from "../util/docker.js";
import { ContextForgeError } from "../util/errors.js";
import { prepare, short } from "./prepare.js";

export interface BenchmarkOptions extends EvaluatorOptions {
  readonly configPath: string;
  readonly fetch?: typeof fetch;
  readonly now?: () => Date;
}

export async function benchmarkCommand(options: BenchmarkOptions): Promise<string> {
  const ctx = await prepare({
    configPath: options.configPath,
    exec: options.exec,
    env: options.env,
    requireKeys: true,
  });
  const { config, git } = ctx;

  const sha = await git.resolve("HEAD");
  if (await git.isDirty()) {
    // A stored benchmark claims to describe a commit. Uncommitted changes
    // would make that claim false for every pull request that relies on it.
    throw new ContextForgeError("GIT_FAILED", "The working tree has uncommitted changes", {
      remedy: `A benchmark is stored under the commit it describes (${short(sha)}). Commit or stash first.`,
    });
  }

  await assertDockerAvailable(options.exec, options.env);

  const side = await answerSide({
    role: "baseline",
    checkout: ctx.repoRoot,
    composeFile: ctx.composeRel,
    config,
    cases: ctx.dataset.cases,
    exec: options.exec,
    logger: options.logger,
    env: options.env,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });

  const image = await ensureEvaluatorImage(options);
  const records = await scoreSide(side.records, ctx.dataset.cases, config, image, options);
  const result = buildRunResult({
    commit: sha,
    fingerprint: buildFingerprint(config, ctx.datasetHash, side.appHash),
    records,
    runs: config.evaluation.runs,
    metrics: config.evaluation.metrics,
    ...(options.now === undefined ? {} : { now: options.now() }),
  });

  const file = storeFile(ctx.storeDir, sha);
  await writeJson(file, result);
  options.logger.info("benchmark stored", { commit: short(sha), file });
  return file;
}
