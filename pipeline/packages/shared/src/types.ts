/**
 * Types shared across packages, as Zod schemas so that anything read from
 * disk — a stored baseline, a results file, a dataset — is parsed rather than
 * trusted. Each exported type is inferred from its schema, so the shape is
 * declared exactly once (pipeline/docs/RULES.md).
 *
 * Formats are specified in pipeline/docs/DESIGN.md sections 3 and 4.
 */

import { z } from "zod";

/**
 * Process exit codes, fixed by `pipeline/docs/DESIGN.md` section 6. CI needs to tell
 * "the quality regressed" apart from "the tool broke", so a regression and a
 * tool error must never share a code.
 */
export const EXIT_CODE = {
  /** The run passed every threshold. */
  pass: 0,
  /** The run completed and found a regression. */
  regression: 1,
  /** ContextForge itself failed: bad config, unreachable app, broken judge. */
  toolError: 2,
} as const;

export type ExitCode = (typeof EXIT_CODE)[keyof typeof EXIT_CODE];

/** The metrics ContextForge knows how to ask the evaluator for. */
export const METRICS = [
  "context_precision",
  "context_recall",
  "faithfulness",
  "answer_relevancy",
] as const;

export type Metric = (typeof METRICS)[number];

export const metricSchema = z.enum(METRICS);

/** A score per metric; `null` means the metric could not be computed. */
export const scoreMapSchema = z.partialRecord(metricSchema, z.number().min(0).max(1).nullable());
export type ScoreMap = z.infer<typeof scoreMapSchema>;

// ---------------------------------------------------------------------------
// benchmark/testcases.json
// ---------------------------------------------------------------------------

export const testCaseSchema = z.strictObject({
  id: z.string().min(1),
  question: z.string().min(1),
  ground_truth: z.string().min(1),
  reference_context_ids: z.array(z.string()),
  hops: z.enum(["single", "multi"]),
});
export type TestCase = z.infer<typeof testCaseSchema>;

export const datasetSchema = z
  .strictObject({
    dataset_version: z.literal(1),
    generated_at: z.string().min(1),
    generator: z.strictObject({
      tool: z.string().min(1),
      version: z.string().min(1),
      model: z.string().min(1),
    }),
    cases: z.array(testCaseSchema).min(1),
  })
  .superRefine((dataset, ctx) => {
    const seen = new Set<string>();
    dataset.cases.forEach((testCase, index) => {
      if (seen.has(testCase.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["cases", index, "id"],
          message: `"${testCase.id}" appears more than once; case ids must be unique`,
        });
      }
      seen.add(testCase.id);
    });
  });
export type Dataset = z.infer<typeof datasetSchema>;

// ---------------------------------------------------------------------------
// Run results: benchmark/baseline/<sha>.json and each side of a comparison
// ---------------------------------------------------------------------------

export const contextRecordSchema = z.strictObject({
  id: z.string().nullable(),
  text: z.string(),
});
export type ContextRecord = z.infer<typeof contextRecordSchema>;

export const caseRecordSchema = z.strictObject({
  case_id: z.string().min(1),
  /** Kept with the answer so a results file explains itself without the dataset. */
  question: z.string(),
  /**
   * `failed` means the app itself did not answer — a non-2xx response or a
   * body breaking the contract. That fails the case, not the run.
   */
  status: z.enum(["ok", "failed"]),
  error: z.string().nullable(),
  answer: z.string().nullable(),
  contexts: z.array(contextRecordSchema),
  scores: scoreMapSchema,
  scores_stddev: scoreMapSchema,
  /** Why a score is null, per metric, as reported by the evaluator. */
  score_errors: z.partialRecord(metricSchema, z.string()),
  latency_ms: z.number().nullable(),
});
export type CaseRecord = z.infer<typeof caseRecordSchema>;

export const judgeFingerprintSchema = z.strictObject({
  model: z.string(),
  temperature: z.number(),
  seed: z.number().nullable(),
  /** Thinking on or off changes the verdicts, so it is part of the judge. */
  reasoning_effort: z.string().nullable(),
});

export const fingerprintSchema = z.strictObject({
  dataset_hash: z.string(),
  app_hash: z.string(),
  judge: judgeFingerprintSchema,
  embeddings: z.strictObject({ model: z.string() }).nullable(),
  tool_version: z.string(),
});
export type Fingerprint = z.infer<typeof fingerprintSchema>;

export const runResultSchema = z.strictObject({
  commit: z.string().min(1),
  created_at: z.string().min(1),
  fingerprint: fingerprintSchema,
  runs: z.number().int().min(1),
  results: z.array(caseRecordSchema),
  /** Mean per metric over the cases that produced a score. */
  summary: scoreMapSchema,
  /** Anything the reader must know to trust these numbers. */
  notes: z.array(z.string()),
});
export type RunResult = z.infer<typeof runResultSchema>;

// ---------------------------------------------------------------------------
// Verdict and results.json
// ---------------------------------------------------------------------------

export const metricVerdictSchema = z.strictObject({
  name: metricSchema,
  baseline: z.number().nullable(),
  candidate: z.number().nullable(),
  delta: z.number().nullable(),
  /** The largest drop allowed, as a negative number, e.g. -0.05. */
  threshold: z.number().nullable(),
  floor: z.number().nullable(),
  status: z.enum(["pass", "fail", "skipped"]),
  reasons: z.array(z.string()),
});
export type MetricVerdict = z.infer<typeof metricVerdictSchema>;

export const modeSchema = z.enum(["cached", "dual"]);
export type Mode = z.infer<typeof modeSchema>;

export const verdictSchema = z.strictObject({
  status: z.enum(["pass", "fail"]),
  mode: modeSchema,
  baseline_commit: z.string(),
  candidate_commit: z.string(),
  judge_model: z.string(),
  metrics: z.array(metricVerdictSchema),
  regressed_cases: z.array(z.string()),
  /** Why each regressed case regressed, so a report needs no config to explain it. */
  regressions: z.array(z.strictObject({ case_id: z.string(), reasons: z.array(z.string()) })),
  notes: z.array(z.string()),
});
export type Verdict = z.infer<typeof verdictSchema>;

/** Everything a report needs, so `contextforge report` works from this alone. */
export const resultsFileSchema = z.strictObject({
  verdict: verdictSchema,
  baseline: runResultSchema,
  candidate: runResultSchema,
});
export type ResultsFile = z.infer<typeof resultsFileSchema>;
