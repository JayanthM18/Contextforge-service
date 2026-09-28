/** Shared test fixtures. No network, no Docker, no real environment. */

import { configSchema, type Config } from "../src/config/schema.js";
import { ContextForgeError } from "../src/util/errors.js";
import type { Exec, ExecOptions, ExecResult } from "../src/util/exec.js";
import { createLogger, type Logger } from "../src/util/logger.js";

export function testConfig(overrides: Record<string, unknown> = {}): Config {
  return configSchema.parse({
    version: 1,
    app: { compose_file: "docker-compose.eval.yml", service: "rag-app" },
    dataset: { path: "testcases.json" },
    evaluation: {
      metrics: ["context_precision", "context_recall", "faithfulness", "answer_relevancy"],
      judge: { provider: "openai", model: "gpt-4o-mini", api_key_env: "OPENAI_API_KEY" },
      embeddings: {
        provider: "openai",
        model: "text-embedding-3-small",
        api_key_env: "OPENAI_API_KEY",
      },
    },
    baseline: {},
    thresholds: {
      mean_drop: {
        context_precision: 0.05,
        context_recall: 0.05,
        faithfulness: 0.05,
        answer_relevancy: 0.05,
      },
      absolute_floor: { faithfulness: 0.7 },
    },
    report: {},
    ...overrides,
  });
}

export const silentLogger: Logger = createLogger({ level: "silent" });

export interface RecordedCall {
  readonly command: string;
  readonly args: readonly string[];
  readonly options: ExecOptions | undefined;
}

/**
 * An `Exec` that records every call and answers from a handler, so tests can
 * assert on the exact commands without running them.
 */
export function fakeExec(
  handler: (
    command: string,
    args: readonly string[],
    options?: ExecOptions,
  ) => Partial<ExecResult> | Promise<Partial<ExecResult>> = () => ({}),
): { exec: Exec; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const exec: Exec = async (command, args, options) => {
    calls.push({ command, args, options });
    const result = await handler(command, args, options);
    return { code: result.code ?? 0, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  };
  return { exec, calls };
}

/**
 * The ContextForgeError that a promise (or a function) produces. Fails the
 * test if it throws something else, or nothing at all.
 */
export async function failure(
  action: Promise<unknown> | (() => unknown),
): Promise<ContextForgeError> {
  try {
    await (typeof action === "function" ? action() : action);
  } catch (error: unknown) {
    if (error instanceof ContextForgeError) return error;
    throw error;
  }
  throw new Error("expected a ContextForgeError, but nothing was thrown");
}
