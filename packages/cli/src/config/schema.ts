/**
 * The `contextforge.yml` schema from `docs/DESIGN.md` section 2.
 *
 * Every object is strict: an unknown key is an error, not a warning. A typo in
 * a config key would otherwise be silently ignored and the run would quietly
 * use a default the user did not intend.
 *
 * This module is pure. Checks that need the filesystem or the environment
 * (does `dataset.path` exist, is the API key variable set) live in `load.ts`.
 */

import { METRICS, type Metric } from "@contextforge/shared";
import { z } from "zod";

export { METRICS, type Metric };

/** Metrics that cannot be computed without an embedding model. */
const METRICS_NEEDING_EMBEDDINGS: readonly Metric[] = ["answer_relevancy"];

// One message for both failure modes: "judge-box:11434" parses as a URL with
// the scheme "judge-box:", so a scheme check is needed as well as a URL check,
// and the user made the same mistake either way.
const ABSOLUTE_HTTP_URL =
  "must be an absolute http or https URL, for example http://localhost:11434/v1";

const absoluteHttpUrl = z
  .url({ error: ABSOLUTE_HTTP_URL })
  .refine((value) => value.startsWith("http://") || value.startsWith("https://"), {
    error: ABSOLUTE_HTTP_URL,
  });

/**
 * Where a model is reached. `base_url` and `api_key_env` are configurable
 * because the endpoint is not always OpenAI's — Azure, a proxy, a gateway and
 * a self-hosted server all speak the same protocol at a different address.
 *
 * `api_key_env` names the variable holding the key. The key itself never
 * appears in the config file.
 */
const endpoint = {
  provider: z.enum(["openai"], {
    error: 'must be "openai" — the wire protocol, not the vendor',
  }),
  model: z.string().min(1, { error: "must name a model" }),
  base_url: absoluteHttpUrl.nullable().default(null),
  api_key_env: z.string().min(1).nullable().default(null),
};

const judgeSchema = z.strictObject({
  ...endpoint,
  temperature: z.number().min(0).max(2).default(0),
  seed: z.number().int().default(42),
  /**
   * OpenAI's reasoning-effort parameter, sent only when set. Reasoning models
   * such as Qwen3 otherwise think before every verdict: slower, and the
   * thinking counts against the response's token budget. Non-reasoning models
   * such as gpt-4o-mini reject the parameter, so it defaults to not sent.
   */
  reasoning_effort: z
    .enum(["none", "minimal", "low", "medium", "high"], {
      error: 'must be "none", "minimal", "low", "medium" or "high"',
    })
    .nullable()
    .default(null),
});

const embeddingsSchema = z.strictObject(endpoint);

const thresholdMap = z.record(
  z.string(),
  z.number().min(0, { error: "must be between 0 and 1" }).max(1, {
    error: "must be between 0 and 1",
  }),
);

const baseSchema = z.strictObject({
  version: z.literal(1, { error: "must be 1; no other config version exists yet" }),

  app: z.strictObject({
    compose_file: z.string().min(1, { error: "must name a Compose file" }),
    service: z.string().min(1, { error: "must name a service in the Compose file" }),
    port: z.number().int().min(1).max(65535).default(8000),
    health_path: z.string().startsWith("/", { error: "must start with /" }).default("/health"),
    query_path: z.string().startsWith("/", { error: "must start with /" }).default("/query"),
    startup_timeout: z
      .number()
      .int()
      .min(10, { error: "must be between 10 and 900 seconds" })
      .max(900, { error: "must be between 10 and 900 seconds" })
      .default(120),
    query_timeout: z
      .number()
      .int()
      .min(1, { error: "must be between 1 and 600 seconds" })
      .max(600, { error: "must be between 1 and 600 seconds" })
      .default(60),
    env_passthrough: z.array(z.string().min(1)).default([]),
  }),

  dataset: z.strictObject({
    path: z.string().min(1, { error: "must point at the frozen test set" }),
    source_docs: z.string().min(1).optional(),
    size: z.number().int().min(1).max(1000).default(40),
  }),

  evaluation: z.strictObject({
    metrics: z
      .array(z.enum(METRICS, { error: `must be one of: ${METRICS.join(", ")}` }))
      .min(1, { error: "must list at least one metric" }),
    judge: judgeSchema,
    embeddings: embeddingsSchema.optional(),
    runs: z.number().int().min(1).max(20).default(1),
    concurrency: z.number().int().min(1).max(32).default(4),
  }),

  baseline: z.strictObject({
    mode: z.enum(["cached", "dual"], { error: 'must be "cached" or "dual"' }).default("cached"),
    store: z.string().min(1).default("benchmark/baseline"),
    rebuild_if_missing: z.boolean().default(true),
  }),

  thresholds: z.strictObject({
    mean_drop: thresholdMap.default({}),
    absolute_floor: thresholdMap.default({}),
    /**
     * How far one case's score may fall before that case counts as regressed.
     * Provisional: single-case judge scores are far noisier than means, and
     * this default is replaced by the spread measured in stage 6.
     */
    case_drop: z
      .number()
      .min(0, { error: "must be between 0 and 1" })
      .max(1, { error: "must be between 0 and 1" })
      .default(0.3),
    max_regressed_cases: z.number().int().min(0).default(3),
  }),

  report: z.strictObject({
    pr_comment: z.boolean().default(true),
    check_status: z.boolean().default(true),
    html_artifact: z.boolean().default(true),
  }),
});

/**
 * Rules that span more than one field, so they cannot be expressed on the
 * field itself. Each reports against the key at fault, not the parent.
 */
export const configSchema = baseSchema.superRefine((config, ctx) => {
  const declared = new Set<string>(config.evaluation.metrics);

  for (const group of ["mean_drop", "absolute_floor"] as const) {
    for (const metric of Object.keys(config.thresholds[group])) {
      if (!(METRICS as readonly string[]).includes(metric)) {
        ctx.addIssue({
          code: "custom",
          path: ["thresholds", group, metric],
          message: `"${metric}" is not a known metric. Known metrics: ${METRICS.join(", ")}`,
        });
        continue;
      }
      if (!declared.has(metric)) {
        ctx.addIssue({
          code: "custom",
          path: ["thresholds", group, metric],
          message: `"${metric}" is not in evaluation.metrics, so it is never measured`,
        });
      }
    }
  }

  const needsEmbeddings = config.evaluation.metrics.filter((metric) =>
    METRICS_NEEDING_EMBEDDINGS.includes(metric),
  );
  if (needsEmbeddings.length > 0 && config.evaluation.embeddings === undefined) {
    ctx.addIssue({
      code: "custom",
      path: ["evaluation", "embeddings"],
      message:
        `is required because evaluation.metrics includes ${needsEmbeddings.join(", ")}, ` +
        `which ${needsEmbeddings.length === 1 ? "is" : "are"} computed from embeddings`,
    });
  }
});

/** The validated config, with every default filled in. */
export type Config = z.output<typeof configSchema>;
