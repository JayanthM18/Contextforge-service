/**
 * The one logger. `docs/RULES.md` bans stray `console.log`, so every package
 * writes through here.
 *
 * Logs go to stderr, never stdout: stdout carries machine-readable output
 * (`results.json`) that CI pipes elsewhere, and mixing the two corrupts it.
 */

export const LOG_LEVELS = ["debug", "info", "warn", "error", "silent"] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

/** Structured context attached to a log line. */
export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  /** A logger that stamps `fields` onto every line it writes. */
  child(fields: LogFields): Logger;
}

export interface LoggerOptions {
  readonly level?: LogLevel;
  /** Where lines are written. Injected so tests can capture output. */
  readonly write?: (line: string) => void;
  /** JSON lines for CI log collectors; text for a human at a terminal. */
  readonly format?: "text" | "json";
}

export function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === "string" && (LOG_LEVELS as readonly string[]).includes(value);
}

function formatText(level: LogLevel, message: string, fields: LogFields): string {
  const pairs = Object.entries(fields).map(([key, value]) => `${key}=${stringify(value)}`);
  const suffix = pairs.length === 0 ? "" : ` ${pairs.join(" ")}`;
  return `${level.toUpperCase().padEnd(5)} ${message}${suffix}`;
}

function stringify(value: unknown): string {
  return typeof value === "object" && value !== null ? JSON.stringify(value) : String(value);
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const level = options.level ?? "info";
  const format = options.format ?? "text";
  const write =
    options.write ??
    ((line: string): void => {
      process.stderr.write(`${line}\n`);
    });

  const make = (bound: LogFields): Logger => {
    const emit = (lineLevel: LogLevel, message: string, fields?: LogFields): void => {
      if (LEVEL_RANK[lineLevel] < LEVEL_RANK[level]) return;
      const merged = { ...bound, ...fields };
      write(
        format === "json"
          ? JSON.stringify({ level: lineLevel, message, ...merged })
          : formatText(lineLevel, message, merged),
      );
    };

    return {
      debug: (message, fields): void => {
        emit("debug", message, fields);
      },
      info: (message, fields): void => {
        emit("info", message, fields);
      },
      warn: (message, fields): void => {
        emit("warn", message, fields);
      },
      error: (message, fields): void => {
        emit("error", message, fields);
      },
      child: (fields): Logger => make({ ...bound, ...fields }),
    };
  };

  return make({});
}
