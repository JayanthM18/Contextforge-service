/** Reading and writing run results. Anything read from disk is parsed. */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  type CaseRecord,
  type Fingerprint,
  type Metric,
  type ResultsFile,
  type RunResult,
  resultsFileSchema,
  runResultSchema,
} from "@contextforge/shared";
import type { z } from "zod";

import { ContextForgeError } from "../util/errors.js";
import { summarise } from "./summary.js";

export function buildRunResult(input: {
  readonly commit: string;
  readonly fingerprint: Fingerprint;
  readonly records: readonly CaseRecord[];
  readonly runs: number;
  readonly metrics: readonly Metric[];
  readonly notes?: readonly string[];
  readonly now?: Date;
}): RunResult {
  return {
    commit: input.commit,
    created_at: (input.now ?? new Date()).toISOString().replace(/\.\d{3}Z$/, "Z"),
    fingerprint: input.fingerprint,
    runs: input.runs,
    results: [...input.records],
    summary: summarise(input.records, input.metrics),
    notes: [...(input.notes ?? [])],
  };
}

async function readParsed<T>(file: string, schema: z.ZodType<T>, what: string): Promise<T> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(file, "utf8"));
  } catch (cause) {
    throw new ContextForgeError("RESULTS_INVALID", `Cannot read ${what} at ${file}`, {
      cause,
      remedy: "Check the path; result files are written by `contextforge run`.",
    });
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .slice(0, 8)
      .map((i) => `    ${i.path.join(".") || "(root)"}: ${i.message}`);
    throw new ContextForgeError(
      "RESULTS_INVALID",
      `${file} is not a valid ${what}:\n${problems.join("\n")}`,
      {
        remedy:
          "It may come from a different ContextForge version; regenerate it with `contextforge run`.",
      },
    );
  }
  return parsed.data;
}

export function readRunResult(file: string): Promise<RunResult> {
  return readParsed(file, runResultSchema, "run result");
}

export function readResultsFile(file: string): Promise<ResultsFile> {
  return readParsed(file, resultsFileSchema, "results file");
}

export async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}
