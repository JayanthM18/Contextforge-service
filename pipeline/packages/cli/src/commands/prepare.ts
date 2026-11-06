/** Setup shared by `run` and `benchmark`: config, test set, repository layout. */

import path from "node:path";

import type { Dataset } from "@contextforge/shared";

import { loadConfig, resolveAgainstConfig } from "../config/load.js";
import type { Config } from "../config/schema.js";
import { datasetHash, loadDataset } from "../dataset/freeze.js";
import type { Exec } from "../util/exec.js";
import { Git } from "../util/git.js";

export interface Prepared {
  readonly config: Config;
  readonly configPath: string;
  readonly dataset: Dataset;
  readonly datasetHash: string;
  readonly git: Git;
  readonly repoRoot: string;
  /** The Compose file relative to the repository root, so it can be found in any checkout. */
  readonly composeRel: string;
  readonly storeDir: string;
  /** The store relative to the repository root, with forward slashes, for `git show`. */
  readonly storeRel: string;
}

function posix(p: string): string {
  return p.split(path.sep).join("/");
}

export async function prepare(options: {
  readonly configPath: string;
  readonly exec: Exec;
  readonly env: Record<string, string | undefined>;
  readonly requireKeys: boolean;
}): Promise<Prepared> {
  const configPath = path.resolve(options.configPath);
  const config = await loadConfig({
    configPath,
    env: options.env,
    requireKeys: options.requireKeys,
  });
  const dataset = await loadDataset(resolveAgainstConfig(configPath, config.dataset.path));

  const git = new Git(options.exec, path.dirname(configPath), options.env);
  const repoRoot = await git.root();
  const storeDir = resolveAgainstConfig(configPath, "benchmark/baseline");

  return {
    config,
    configPath,
    dataset,
    datasetHash: datasetHash(dataset),
    git,
    repoRoot,
    composeRel: posix(
      path.relative(repoRoot, resolveAgainstConfig(configPath, config.app.compose_file)),
    ),
    storeDir,
    storeRel: posix(path.relative(repoRoot, storeDir)),
  };
}

export function short(sha: string): string {
  return sha.slice(0, 7);
}
