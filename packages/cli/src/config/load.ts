/**
 * Loading and validating `contextforge.yml`.
 *
 * All the I/O the config needs lives here — reading the file, checking that
 * referenced paths exist, checking that the named key variables are set — so
 * `schema.ts` stays a pure description of the shape.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { parse as parseYaml, YAMLParseError } from "yaml";
import type { $ZodIssue } from "zod/v4/core";

import { ContextForgeError } from "../util/errors.js";
import { type Config, configSchema } from "./schema.js";

export interface LoadConfigOptions {
  /** Path to `contextforge.yml`, absolute or relative to `cwd`. */
  readonly configPath: string;
  /**
   * `dataset generate` writes the test set, so it is the one command that may
   * run before `dataset.path` exists.
   */
  readonly requireDataset?: boolean;
  /**
   * Whether the key variables named by `api_key_env` must be set. Commands that
   * never call the judge, like `compare` and `report`, turn this off.
   */
  readonly requireKeys?: boolean;
  /** Injected so tests never touch the real environment. */
  readonly env?: Record<string, string | undefined>;
  readonly cwd?: string;
}

/**
 * A Zod issue path rendered as a config key. Unrecognised keys are the
 * awkward case: Zod reports them against the *containing* object with the
 * offending names in a separate field, so the key has to be appended by hand
 * or the error would name the parent and leave the user hunting.
 */
export function describeIssue(issue: $ZodIssue): string[] {
  const base = issue.path.join(".");

  if (issue.code === "unrecognized_keys") {
    return issue.keys.map((key) => {
      const full = base === "" ? key : `${base}.${key}`;
      return `${full}: unrecognized key`;
    });
  }

  return [base === "" ? issue.message : `${base}: ${issue.message}`];
}

/** Every problem in one error, so a user fixes the file once rather than five times. */
export function formatIssues(configPath: string, issues: readonly $ZodIssue[]): ContextForgeError {
  const lines = issues.flatMap(describeIssue);
  const count = lines.length === 1 ? "1 problem" : `${String(lines.length)} problems`;

  return new ContextForgeError(
    "CONFIG_INVALID",
    `${configPath} has ${count}:\n${lines.map((line) => `    ${line}`).join("\n")}`,
    { remedy: "See docs/DESIGN.md section 2 for the config schema." },
  );
}

/**
 * Paths inside the config resolve against the directory holding the config
 * file, not the working directory, so a config is portable and means the same
 * thing wherever it is run from.
 */
export function resolveAgainstConfig(configPath: string, value: string): string {
  return path.resolve(path.dirname(path.resolve(configPath)), value);
}

function checkKeyVariables(config: Config, env: Record<string, string | undefined>): void {
  const endpoints = [
    { key: "evaluation.judge", endpoint: config.evaluation.judge },
    { key: "evaluation.embeddings", endpoint: config.evaluation.embeddings },
  ];

  for (const { key, endpoint } of endpoints) {
    if (endpoint?.api_key_env == null) continue;

    const value = env[endpoint.api_key_env];
    if (value === undefined || value === "") {
      throw new ContextForgeError(
        "CONFIG_INVALID",
        `${key}.api_key_env names ${endpoint.api_key_env}, but that variable is not set`,
        {
          remedy:
            `Export ${endpoint.api_key_env}, or set ${key}.api_key_env to null if the ` +
            `endpoint needs no key.`,
        },
      );
    }
  }
}

export async function loadConfig(options: LoadConfigOptions): Promise<Config> {
  const cwd = options.cwd ?? process.cwd();
  const configPath = path.resolve(cwd, options.configPath);
  // A relative path only helps when it stays inside the working directory;
  // "../../../../tmp/x.yml" is worse than the absolute path it came from.
  const relative = path.relative(cwd, configPath);
  const display = relative === "" || relative.startsWith("..") ? configPath : relative;

  let source: string;
  try {
    source = await readFile(configPath, "utf8");
  } catch (cause) {
    throw new ContextForgeError("CONFIG_INVALID", `Cannot read ${display}`, {
      cause,
      remedy: "Check the path, or pass --config with the right one.",
    });
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(source);
  } catch (cause) {
    const where =
      cause instanceof YAMLParseError && cause.linePos !== undefined
        ? ` at line ${String(cause.linePos[0].line)}`
        : "";
    const detail = cause instanceof Error ? cause.message.split("\n")[0] : undefined;
    throw new ContextForgeError("CONFIG_INVALID", `${display} is not valid YAML${where}`, {
      cause,
      ...(detail === undefined ? {} : { remedy: detail }),
    });
  }

  if (parsed === null || parsed === undefined) {
    throw new ContextForgeError("CONFIG_INVALID", `${display} is empty`, {
      remedy: "See docs/DESIGN.md section 2 for the config schema.",
    });
  }

  const result = configSchema.safeParse(parsed);
  if (!result.success) throw formatIssues(display, result.error.issues);

  const config = result.data;
  if (options.requireKeys !== false) checkKeyVariables(config, options.env ?? process.env);

  if (options.requireDataset !== false) {
    const datasetPath = resolveAgainstConfig(configPath, config.dataset.path);
    if (!existsSync(datasetPath)) {
      throw new ContextForgeError(
        "CONFIG_INVALID",
        `dataset.path points at ${config.dataset.path}, which does not exist`,
        {
          remedy: "Run `contextforge dataset generate` to create it, then review and commit it.",
        },
      );
    }
  }

  return config;
}
