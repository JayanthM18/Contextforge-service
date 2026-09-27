/** `contextforge dataset generate --config <path> [--size <n>] [--overwrite]` */

import { generateResponseSchema } from "../evaluator/types.js";
import { loadConfig, resolveAgainstConfig } from "../config/load.js";
import { buildGenerateRequest, readSourceDocuments, toDataset } from "../dataset/generate.js";
import { assertWritable, writeDataset } from "../dataset/freeze.js";
import {
  ensureEvaluatorImage,
  runEvaluatorTask,
  type EvaluatorOptions,
} from "../evaluator/client.js";
import { assertDockerAvailable } from "../util/docker.js";
import { ContextForgeError } from "../util/errors.js";

export interface DatasetGenerateOptions extends EvaluatorOptions {
  readonly configPath: string;
  readonly size?: number;
  readonly overwrite: boolean;
  readonly now?: () => Date;
}

export async function datasetGenerateCommand(options: DatasetGenerateOptions): Promise<string> {
  // The one command allowed to run before dataset.path exists.
  const config = await loadConfig({
    configPath: options.configPath,
    requireDataset: false,
    env: options.env,
  });

  if (config.dataset.source_docs === undefined) {
    throw new ContextForgeError("CONFIG_INVALID", "dataset.source_docs is not set", {
      remedy: "Point it at the directory of documents the app answers from.",
    });
  }

  const datasetPath = resolveAgainstConfig(options.configPath, config.dataset.path);
  const sourceDir = resolveAgainstConfig(options.configPath, config.dataset.source_docs);
  const size = options.size ?? config.dataset.size;

  // Refuse before spending the judge's time on a file that cannot be written.
  assertWritable(datasetPath, { overwrite: options.overwrite });

  const documents = await readSourceDocuments(sourceDir);
  options.logger.info("generating a draft test set", { documents: documents.length, size });

  await assertDockerAvailable(options.exec, options.env);
  const image = await ensureEvaluatorImage(options);
  const response = await runEvaluatorTask(
    image,
    "generate",
    buildGenerateRequest(config, documents, size),
    generateResponseSchema,
    options,
  );

  if (response.cases.length === 0) {
    throw new ContextForgeError("EVALUATOR_FAILED", "The generator produced no usable cases", {
      remedy:
        "Check the judge is reachable and capable of structured output; rerun with --log-level debug.",
    });
  }

  const dataset = toDataset(response, (options.now ?? (() => new Date()))());
  await writeDataset(datasetPath, dataset, { overwrite: true });

  options.logger.info("draft test set written — review it, delete weak cases, then commit", {
    path: datasetPath,
    cases: dataset.cases.length,
    requested: size,
  });
  return datasetPath;
}
