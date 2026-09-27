/**
 * The `contextforge` binary.
 *
 * Exit codes are fixed by `docs/DESIGN.md` section 6 and must not drift: CI
 * needs to tell "quality regressed" (1) apart from "the tool broke" (2).
 */

import { Command } from "commander";

import { EXIT_CODE } from "@contextforge/shared";

import { datasetGenerateCommand } from "./commands/dataset.js";
import { validateCommand } from "./commands/validate.js";
import { exec } from "./util/exec.js";
import { ContextForgeError, isContextForgeError } from "./util/errors.js";
import { createLogger, isLogLevel, type LogLevel, type Logger } from "./util/logger.js";
import { TOOL_VERSION } from "./util/version.js";

interface GlobalOptions {
  readonly logLevel?: string;
}

function resolveLogLevel(raw: string | undefined): LogLevel {
  if (raw === undefined) return "info";
  if (!isLogLevel(raw)) {
    throw new ContextForgeError("CONFIG_INVALID", `--log-level "${raw}" is not a known level`, {
      remedy: "Use one of: debug, info, warn, error, silent.",
    });
  }
  return raw;
}

function parseCount(raw: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new ContextForgeError(
      "CONFIG_INVALID",
      `--size "${raw}" must be a whole number of at least 1`,
    );
  }
  return value;
}

export function buildProgram(): Command {
  const program = new Command();

  program
    .name("contextforge")
    .description("CI regression testing for RAG applications")
    .version(TOOL_VERSION)
    .option("--log-level <level>", "debug | info | warn | error | silent", "info")
    // Subcommands own their exit codes; Commander must not call process.exit.
    .exitOverride();

  const logger = (): Logger =>
    createLogger({ level: resolveLogLevel(program.opts<GlobalOptions>().logLevel) });

  program
    .command("validate")
    .description("Parse and validate contextforge.yml")
    .requiredOption("--config <path>", "path to contextforge.yml")
    .action(async (options: { config: string }) => {
      await validateCommand({ configPath: options.config, logger: logger() });
    });

  const dataset = program.command("dataset").description("Manage the frozen test set");
  dataset
    .command("generate")
    .description("Generate a draft test set from dataset.source_docs, for a human to review")
    .requiredOption("--config <path>", "path to contextforge.yml")
    .option("--size <n>", "number of cases to generate (default: dataset.size)", parseCount)
    .option("--overwrite", "replace an existing test set; regenerating changes the exam", false)
    .action(async (options: { config: string; size?: number; overwrite: boolean }) => {
      await datasetGenerateCommand({
        configPath: options.config,
        overwrite: options.overwrite,
        ...(options.size === undefined ? {} : { size: options.size }),
        exec,
        logger: logger(),
        env: process.env,
      });
    });

  return program;
}

export async function run(argv: readonly string[]): Promise<number> {
  try {
    await buildProgram().parseAsync(argv, { from: "user" });
    return EXIT_CODE.pass;
  } catch (error: unknown) {
    if (isContextForgeError(error)) {
      process.stderr.write(`${error.format()}\n`);
      return EXIT_CODE.toolError;
    }

    // Commander throws for --help and --version, which are not failures.
    if (error instanceof Error && "code" in error && typeof error.code === "string") {
      const commanderCode = error.code;
      if (commanderCode === "commander.helpDisplayed" || commanderCode === "commander.version") {
        return EXIT_CODE.pass;
      }
      process.stderr.write(`${error.message}\n`);
      return EXIT_CODE.toolError;
    }

    process.stderr.write(`Unexpected failure: ${String(error)}\n`);
    return EXIT_CODE.toolError;
  }
}
