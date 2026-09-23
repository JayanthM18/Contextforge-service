/** Reading the knowledge base off disk. The only file I/O in the app. */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { chunkDocument, type ChunkOptions } from "./chunk.ts";
import type { Chunk } from "./types.ts";

export async function loadCorpus(directory: string, options: ChunkOptions): Promise<Chunk[]> {
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch (cause) {
    throw new Error(
      `Cannot read the knowledge base at "${path.resolve(directory)}". ` +
        `Set KNOWLEDGE_BASE_DIR to the directory holding the source documents.`,
      { cause },
    );
  }

  // Sorted so chunk ids are identical on every machine and in every container.
  const files = entries.filter((entry) => entry.endsWith(".md")).sort((a, b) => a.localeCompare(b));

  if (files.length === 0) {
    throw new Error(`No .md documents found in "${path.resolve(directory)}".`);
  }

  const chunks: Chunk[] = [];
  for (const file of files) {
    const text = await readFile(path.join(directory, file), "utf8");
    chunks.push(...chunkDocument(file, text, options));
  }
  return chunks;
}
