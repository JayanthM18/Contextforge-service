/**
 * Running external programs — `docker`, `git`. Everything that shells out goes
 * through an `Exec`, so callers can be tested by injecting a fake that records
 * the arguments instead of starting real containers.
 */

import { spawn } from "node:child_process";

import { ContextForgeError } from "./errors.js";

export interface ExecOptions {
  readonly cwd?: string;
  /** The complete environment. Nothing is inherited implicitly. */
  readonly env?: Record<string, string | undefined>;
  readonly input?: string;
  readonly timeoutMs?: number;
  /** Called with each stderr line as it arrives, for progress logging. */
  readonly onStderrLine?: (line: string) => void;
}

export interface ExecResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type Exec = (
  command: string,
  args: readonly string[],
  options?: ExecOptions,
) => Promise<ExecResult>;

export const exec: Exec = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let pending = "";
    let timedOut = false;

    const timer =
      options.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            child.kill("SIGTERM");
          }, options.timeoutMs);

    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
      if (options.onStderrLine === undefined) return;
      pending += chunk;
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) if (line.trim() !== "") options.onStderrLine(line);
    });

    child.on("error", (error: NodeJS.ErrnoException) => {
      if (timer !== undefined) clearTimeout(timer);
      if (error.code === "ENOENT") {
        reject(
          new ContextForgeError(
            "DOCKER_UNAVAILABLE",
            `"${command}" is not installed or not on PATH`,
            {
              cause: error,
              remedy: `Install ${command} and make sure it is on PATH.`,
            },
          ),
        );
        return;
      }
      reject(error);
    });

    child.on("close", (code) => {
      if (timer !== undefined) clearTimeout(timer);
      if (pending.trim() !== "" && options.onStderrLine !== undefined) {
        options.onStderrLine(pending);
      }
      if (timedOut) {
        resolve({
          code: 124,
          stdout,
          stderr: `${stderr}\n[timed out after ${String(options.timeoutMs)}ms]`,
        });
        return;
      }
      resolve({ code: code ?? 1, stdout, stderr });
    });

    if (options.input !== undefined) child.stdin.end(options.input);
    else child.stdin.end();
  });

/** The last few lines of a program's stderr, for putting in an error message. */
export function tail(text: string, lines = 15): string {
  return text.trim().split("\n").slice(-lines).join("\n");
}
