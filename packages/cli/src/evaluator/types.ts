/**
 * The evaluator's JSON contract, from docs/DESIGN.md section 7. The response
 * comes from another process in another language, so it is parsed, never
 * trusted.
 */

import { metricSchema } from "@contextforge/shared";
import { z } from "zod";

export const endpointSchema = z.strictObject({
  model: z.string().min(1),
  base_url: z.string().nullable(),
  api_key_env: z.string().nullable(),
});

export const scoreRequestSchema = z.strictObject({
  task: z.literal("score"),
  metrics: z.array(metricSchema).min(1),
  judge: endpointSchema.extend({ temperature: z.number(), seed: z.number().int() }),
  embeddings: endpointSchema.nullable(),
  concurrency: z.number().int().min(1),
  cases: z.array(
    z.strictObject({
      case_id: z.string().min(1),
      question: z.string().min(1),
      ground_truth: z.string(),
      answer: z.string(),
      contexts: z.array(z.string()),
    }),
  ),
});
export type ScoreRequest = z.infer<typeof scoreRequestSchema>;
export type ScoreRequestCase = ScoreRequest["cases"][number];

export const scoreResponseSchema = z.strictObject({
  evaluator: z.strictObject({
    ragas_version: z.string(),
    judge_model: z.string(),
    embeddings_model: z.string().nullable(),
  }),
  results: z.array(
    z.strictObject({
      case_id: z.string(),
      scores: z.record(z.string(), z.number().nullable()),
      errors: z.record(z.string(), z.string()),
    }),
  ),
});
export type ScoreResponse = z.infer<typeof scoreResponseSchema>;

export const generateRequestSchema = z.strictObject({
  task: z.literal("generate"),
  size: z.number().int().min(1),
  judge: endpointSchema.extend({ temperature: z.number(), seed: z.number().int() }),
  embeddings: endpointSchema,
  documents: z.array(z.strictObject({ id: z.string().min(1), text: z.string().min(1) })).min(1),
});
export type GenerateRequest = z.infer<typeof generateRequestSchema>;

export const generateResponseSchema = z.strictObject({
  generator: z.strictObject({ tool: z.string(), version: z.string(), model: z.string() }),
  cases: z.array(
    z.strictObject({
      question: z.string().min(1),
      ground_truth: z.string().min(1),
      reference_document_ids: z.array(z.string()),
      hops: z.enum(["single", "multi"]),
    }),
  ),
});
export type GenerateResponse = z.infer<typeof generateResponseSchema>;
