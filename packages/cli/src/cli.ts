/**
 * The `contextforge` binary.
 *
 * Exit codes are fixed by `docs/DESIGN.md` section 6 and must not drift: CI
 * needs to tell "quality regressed" (1) apart from "the tool broke" (2).
 */

import { Command } from "commander";

import { EXIT_CODE } from "@contextforge/shared";

import { validateCommand } from "./commands/validate.js";
import { ContextForgeError, isContextForgeError } from "./util/errors.js";
import { createLogger, isLogLevel, type LogLevel } from "./util/logger.js";

const VERSION = "0.0.0";

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

export function buildProgram(): Command {
  const program = new Command();

  program
    .name("contextforge")
    .description("CI regression testing for RAG applications")
    .version(VERSION)
    .option("--log-level <level>", "debug | info | warn | error | silent", "info")
    // Subcommands own their exit codes; Commander must not call process.exit.
    .exitOverride();

  program
    .command("validate")
    .description("Parse and validate contextforge.yml")
    .requiredOption("--config <path>", "path to contextforge.yml")
    .action(async (options: { config: string }) => {
      const logger = createLogger({
        level: resolveLogLevel(program.opts<GlobalOptions>().logLevel),
      });
      await validateCommand({ configPath: options.config, logger });
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
