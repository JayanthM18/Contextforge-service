/** `contextforge validate --config <path>` */

import { loadConfig, type LoadConfigOptions } from "../config/load.js";
import type { Config } from "../config/schema.js";
import type { Logger } from "../util/logger.js";

export interface ValidateOptions extends LoadConfigOptions {
  readonly logger: Logger;
}

/**
 * Loads the config and reports what it resolved to. Printing the effective
 * values matters more than a bare "ok": most config surprises are a default
 * the user did not know was there.
 */
export async function validateCommand(options: ValidateOptions): Promise<Config> {
  const config = await loadConfig(options);
  const { judge, embeddings } = config.evaluation;

  options.logger.info("config is valid", {
    config: options.configPath,
    app: `${config.app.service} (${config.app.compose_file})`,
    dataset: config.dataset.path,
    metrics: config.evaluation.metrics.join(", "),
    judge: `${judge.model} @ ${judge.base_url ?? "default endpoint"}`,
    embeddings:
      embeddings === undefined
        ? "none"
        : `${embeddings.model} @ ${embeddings.base_url ?? "default endpoint"}`,
    mode: config.baseline.mode,
    runs: config.evaluation.runs,
  });

  return config;
}
