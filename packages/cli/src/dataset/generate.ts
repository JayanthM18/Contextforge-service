/** Turning source documents into a draft test set through the evaluator. */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { Dataset } from "@contextforge/shared";

import type { Config } from "../config/schema.js";
import { ContextForgeError } from "../util/errors.js";
import type { GenerateRequest, GenerateResponse } from "../evaluator/types.js";

const DOCUMENT_EXTENSIONS = new Set([".md", ".markdown", ".txt"]);

export interface SourceDocument {
  readonly id: string;
  readonly text: string;
}

/**
 * Every text document under `directory`, recursively, in a stable order. Ids
 * are paths relative to the directory, which is what the app's own chunk ids
 * are built from.
 */
export async function readSourceDocuments(directory: string): Promise<SourceDocument[]> {
  let entries: string[];
  try {
    entries = await readdir(directory, { recursive: true });
  } catch (cause) {
    throw new ContextForgeError(
      "CONFIG_INVALID",
      `Cannot read dataset.source_docs at ${directory}`,
      {
        cause,
        remedy:
          "Point dataset.source_docs at the directory holding the documents the app answers from.",
      },
    );
  }

  const files = entries
    .map((entry) => entry.split(path.sep).join("/"))
    .filter((entry) => DOCUMENT_EXTENSIONS.has(path.extname(entry).toLowerCase()))
    .sort();

  const documents: SourceDocument[] = [];
  for (const file of files) {
    const text = (await readFile(path.join(directory, file), "utf8")).trim();
    if (text !== "") documents.push({ id: file, text });
  }

  if (documents.length === 0) {
    throw new ContextForgeError("CONFIG_INVALID", `No documents found in ${directory}`, {
      remedy: `dataset.source_docs must contain ${[...DOCUMENT_EXTENSIONS].join(", ")} files.`,
    });
  }
  return documents;
}

export function buildGenerateRequest(
  config: Config,
  documents: readonly SourceDocument[],
  size: number,
): GenerateRequest {
  const { judge, embeddings } = config.evaluation;
  if (embeddings === undefined) {
    throw new ContextForgeError(
      "CONFIG_INVALID",
      "evaluation.embeddings is required to generate a test set",
      {
        remedy:
          "Ragas builds a knowledge graph from embeddings before writing questions; configure evaluation.embeddings.",
      },
    );
  }
  return {
    task: "generate",
    size,
    judge: {
      model: judge.model,
      base_url: judge.base_url,
      api_key_env: judge.api_key_env,
      temperature: judge.temperature,
      seed: judge.seed,
    },
    embeddings: {
      model: embeddings.model,
      base_url: embeddings.base_url,
      api_key_env: embeddings.api_key_env,
    },
    documents: documents.map((doc) => ({ id: doc.id, text: doc.text })),
  };
}

/** Number cases tc-001, tc-002…, wide enough to sort correctly. Pure. */
export function toDataset(response: GenerateResponse, generatedAt: Date): Dataset {
  const width = Math.max(3, String(response.cases.length).length);
  return {
    dataset_version: 1,
    generated_at: generatedAt.toISOString().replace(/\.\d{3}Z$/, "Z"),
    generator: response.generator,
    cases: response.cases.map((generated, index) => ({
      id: `tc-${String(index + 1).padStart(width, "0")}`,
      question: generated.question,
      ground_truth: generated.ground_truth,
      reference_context_ids: generated.reference_document_ids,
      hops: generated.hops,
    })),
  };
}
