/**
 * Loading and writing the frozen test set. "Frozen means frozen"
 * (docs/DESIGN.md section 3): nothing overwrites it unless explicitly told to.
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { type Dataset, datasetSchema } from "@contextforge/shared";

import { ContextForgeError } from "../util/errors.js";
import { hashData } from "./hash.js";

export async function loadDataset(datasetPath: string): Promise<Dataset> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(datasetPath, "utf8"));
  } catch (cause) {
    throw new ContextForgeError("DATASET_INVALID", `Cannot read the test set at ${datasetPath}`, {
      cause,
      remedy: "Run `contextforge dataset generate`, review the result and commit it.",
    });
  }

  const parsed = datasetSchema.safeParse(raw);
  if (!parsed.success) {
    const problems = parsed.error.issues.map(
      (issue) => `    ${issue.path.join(".") || "(root)"}: ${issue.message}`,
    );
    throw new ContextForgeError(
      "DATASET_INVALID",
      `${datasetPath} does not match the test-set format:\n${problems.join("\n")}`,
      { remedy: "See docs/DESIGN.md section 3 for the testcases.json format." },
    );
  }
  return parsed.data;
}

/** The dataset's fingerprint: its cases only, so the timestamp does not count. */
export function datasetHash(dataset: Dataset): string {
  return hashData(dataset.cases);
}

/** Refuse to replace a frozen test set unless told to. Writes nothing. */
export function assertWritable(
  datasetPath: string,
  options: { readonly overwrite: boolean },
): void {
  if (existsSync(datasetPath) && !options.overwrite) {
    throw new ContextForgeError("DATASET_INVALID", `${datasetPath} already exists`, {
      remedy:
        "Regenerating changes the exam, so every comparison across the change is meaningless. " +
        "If that is intended, rerun with --overwrite, in its own pull request, and record it in docs/MEMORY.md.",
    });
  }
}

export async function writeDataset(
  datasetPath: string,
  dataset: Dataset,
  options: { readonly overwrite: boolean },
): Promise<void> {
  assertWritable(datasetPath, options);
  await mkdir(path.dirname(datasetPath), { recursive: true });
  await writeFile(datasetPath, `${JSON.stringify(dataset, null, 2)}\n`);
}
