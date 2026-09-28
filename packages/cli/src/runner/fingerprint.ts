/**
 * Fingerprints decide whether a stored benchmark can be reused
 * (docs/DESIGN.md section 3).
 *
 * `app_hash` covers the app's *environment* — the Compose file, each build
 * context's Dockerfile and dependency lockfiles — and deliberately not its
 * source code. Source changes are exactly what a pull request is being tested
 * for; environment changes mean the stored answers came from a different
 * world and both sides must be rebuilt.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import type { Fingerprint } from "@contextforge/shared";
import { parse as parseYaml } from "yaml";

import type { Config } from "../config/schema.js";
import { hashData, sha256 } from "../dataset/hash.js";
import { ContextForgeError } from "../util/errors.js";
import { TOOL_VERSION } from "../util/version.js";

const LOCKFILES = [
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
  "requirements.txt",
  "poetry.lock",
  "uv.lock",
  "Pipfile.lock",
  "go.sum",
  "Cargo.lock",
  "Gemfile.lock",
  "composer.lock",
];

interface BuildContext {
  readonly context: string;
  readonly dockerfile: string;
}

/** The build contexts a Compose file declares, relative to its directory. Pure. */
export function buildContexts(compose: unknown): BuildContext[] {
  const services =
    (compose as { services?: Record<string, { build?: unknown }> } | null)?.services ?? {};
  const contexts: BuildContext[] = [];
  for (const service of Object.values(services)) {
    const build = service.build;
    if (typeof build === "string") contexts.push({ context: build, dockerfile: "Dockerfile" });
    else if (build !== null && typeof build === "object") {
      const spec = build as { context?: unknown; dockerfile?: unknown };
      contexts.push({
        context: typeof spec.context === "string" ? spec.context : ".",
        dockerfile: typeof spec.dockerfile === "string" ? spec.dockerfile : "Dockerfile",
      });
    }
  }
  return contexts;
}

/**
 * Hash of the app's environment files. Paths are relative to the Compose
 * file, so the same files hash identically in a worktree and in the working
 * copy.
 */
export async function appHash(composeFile: string): Promise<string> {
  let source: string;
  try {
    source = await readFile(composeFile, "utf8");
  } catch (cause) {
    throw new ContextForgeError(
      "CONFIG_INVALID",
      `app.compose_file ${composeFile} does not exist`,
      {
        cause,
        remedy: "Point app.compose_file at the Compose file that builds the app.",
      },
    );
  }

  const root = path.dirname(composeFile);
  const entries: [string, string][] = [["compose", sha256(source)]];

  for (const { context, dockerfile } of buildContexts(parseYaml(source))) {
    const contextDir = path.resolve(root, context);
    for (const name of [dockerfile, ...LOCKFILES]) {
      const file = path.resolve(contextDir, name);
      if (existsSync(file)) {
        entries.push([
          path.relative(root, file).split(path.sep).join("/"),
          sha256(await readFile(file)),
        ]);
      }
    }
  }

  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return hashData(entries);
}

export function buildFingerprint(config: Config, datasetHash: string, app: string): Fingerprint {
  const { judge, embeddings } = config.evaluation;
  return {
    dataset_hash: datasetHash,
    app_hash: app,
    judge: {
      model: judge.model,
      temperature: judge.temperature,
      seed: judge.seed,
      reasoning_effort: judge.reasoning_effort,
    },
    embeddings: embeddings === undefined ? null : { model: embeddings.model },
    tool_version: TOOL_VERSION,
  };
}
