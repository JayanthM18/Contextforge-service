/**
 * The benchmark store: one `benchmark/baseline/<sha>.json` per commit on the
 * base branch, so concurrent merges never conflict (docs/DESIGN.md section 3).
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { type RunResult, runResultSchema } from "@contextforge/shared";

import type { Git } from "../util/git.js";
import type { Logger } from "../util/logger.js";

/** How far back from the merge base to look before giving up. */
export const ANCESTOR_LIMIT = 50;

export interface StoredBenchmark {
  readonly sha: string;
  readonly result: RunResult;
  /** Commits between the merge base and the benchmark; 0 means the merge base itself. */
  readonly distance: number;
}

export interface FindOptions {
  readonly git: Git;
  readonly logger: Logger;
  readonly mergeBase: string;
  /** The store directory relative to the repository root, with forward slashes. */
  readonly storeRel: string;
  /** The store directory on disk, for benchmarks not yet on the base branch. */
  readonly storeDir: string;
  /** The base branch ref whose tree holds committed benchmarks, e.g. origin/main. */
  readonly baseRef: string | null;
  readonly limit?: number;
}

async function readStored(options: FindOptions, sha: string): Promise<string | null> {
  const file = `${sha}.json`;
  // Benchmarks are committed to the base branch *after* the commit they
  // describe, so a pull request that branched just before that commit landed
  // has no copy in its own tree. The base branch's tree always does.
  if (options.baseRef !== null) {
    const fromBase = await options.git.show(options.baseRef, `${options.storeRel}/${file}`);
    if (fromBase !== null) return fromBase;
  }
  const local = path.join(options.storeDir, file);
  return existsSync(local) ? readFile(local, "utf8") : null;
}

/** The nearest stored benchmark at or before the merge base, if any. */
export async function findStoredBenchmark(options: FindOptions): Promise<StoredBenchmark | null> {
  const ancestors = await options.git.ancestors(options.mergeBase, options.limit ?? ANCESTOR_LIMIT);

  for (const [distance, sha] of ancestors.entries()) {
    const raw = await readStored(options, sha);
    if (raw === null) continue;

    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      options.logger.warn("ignoring an unreadable stored benchmark", { sha });
      continue;
    }
    const parsed = runResultSchema.safeParse(json);
    if (!parsed.success) {
      options.logger.warn("ignoring a stored benchmark in an unknown format", { sha });
      continue;
    }
    return { sha, result: parsed.data, distance };
  }
  return null;
}

export function storeFile(storeDir: string, sha: string): string {
  return path.join(storeDir, `${sha}.json`);
}
