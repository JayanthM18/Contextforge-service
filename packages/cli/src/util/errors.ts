/**
 * Every failure a user can hit is a `ContextForgeError` with a stable code and
 * a message naming the file, key or container at fault. `docs/RULES.md` bans
 * bare `throw new Error("failed")`: a code is what lets CI, tests and the
 * report distinguish one failure from another.
 */

/**
 * Stable, machine-readable failure codes. Codes are added as stages land; they
 * are never renamed or reused, because reports and tests match on them.
 */
export const ERROR_CODE = {
  /** `contextforge.yml` is missing, unparseable, or fails schema validation. */
  configInvalid: "CONFIG_INVALID",
  /** `docker` is not installed, or its daemon is not running. */
  dockerUnavailable: "DOCKER_UNAVAILABLE",
  /** The evaluator container failed or returned something unusable. */
  evaluatorFailed: "EVALUATOR_FAILED",
  /** The test set is missing, malformed, or would be overwritten by accident. */
  datasetInvalid: "DATASET_INVALID",
  /** The app under test would not build, start, or become healthy. */
  appFailed: "APP_FAILED",
  /** A Git operation failed: an unknown ref, a missing merge base. */
  gitFailed: "GIT_FAILED",
  /** A stored or supplied result file is missing or malformed. */
  resultsInvalid: "RESULTS_INVALID",
  /** Posting to GitHub failed. */
  githubFailed: "GITHUB_FAILED",
  /** An internal invariant broke. Always a bug in ContextForge. */
  internal: "INTERNAL",
} as const;

export type ErrorCode = (typeof ERROR_CODE)[keyof typeof ERROR_CODE];

export interface ContextForgeErrorOptions {
  /** The underlying failure, kept so the original stack is not lost. */
  readonly cause?: unknown;
  /**
   * What the user should do next. Rendered under the message, because an error
   * that does not say what to do next is a bug report waiting to happen.
   */
  readonly remedy?: string;
}

export class ContextForgeError extends Error {
  override readonly name = "ContextForgeError";

  readonly code: ErrorCode;

  remedy: string | undefined;

  constructor(code: ErrorCode, message: string, options: ContextForgeErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.code = code;
    this.remedy = options.remedy;
  }

  /** The full user-facing text: what went wrong, then what to do about it. */
  format(): string {
    return this.remedy === undefined
      ? `[${this.code}] ${this.message}`
      : `[${this.code}] ${this.message}\n  → ${this.remedy}`;
  }
}

export function isContextForgeError(value: unknown): value is ContextForgeError {
  return value instanceof ContextForgeError;
}
