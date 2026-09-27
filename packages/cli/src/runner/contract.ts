/**
 * The app contract from docs/DESIGN.md section 1, as the runner enforces it.
 * The app is someone else's code in someone else's language, so its responses
 * are parsed, never trusted.
 */

import { z } from "zod";

export const queryResponseSchema = z.object({
  answer: z.string({ error: "answer must be a plain string" }),
  contexts: z.array(
    z.object({
      text: z.string({ error: "contexts[].text is required and must be a string" }),
      id: z.string().optional(),
      score: z.number().optional(),
    }),
    { error: "contexts must be an array of { text, id?, score? }" },
  ),
  metadata: z
    .object({
      latency_ms: z.number().optional(),
      tokens: z.object({ prompt: z.number(), completion: z.number() }).optional(),
    })
    .optional(),
});
export type QueryResponse = z.infer<typeof queryResponseSchema>;
