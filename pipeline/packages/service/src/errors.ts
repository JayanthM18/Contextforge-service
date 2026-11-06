export type ServiceErrorCode =
  | "WEBHOOK_INVALID"
  | "WEBHOOK_TOO_LARGE"
  | "GITHUB_API_FAILED"
  | "SERVICE_CONFIGURATION_INVALID"
  | "SERVICE_ALREADY_RUNNING"
  | "LOCAL_STATE_INVALID"
  | "LOCAL_JOB_INVALID"
  | "LOCAL_JOB_UNSUPPORTED"
  | "LOCAL_FORK_DISABLED"
  | "LOCAL_CHECKOUT_MISMATCH"
  | "LOCAL_EVALUATION_FAILED"
  | "LOCAL_EVALUATION_INVALID"
  | "LOCAL_WORKTREE_CLEANUP_FAILED"
  | "LOCAL_MERGE_BASE_FAILED"
  | "LOCAL_GIT_FAILED"
  | "JOB_NOT_FOUND"
  | "JOB_NOT_COMPLETED"
  | "WEBHOOK_REPOSITORY_NOT_ALLOWED"
  | "LOCAL_REPOSITORY_MISMATCH";

export class ServiceError extends Error {
  override readonly name = "ServiceError";

  constructor(
    readonly code: ServiceErrorCode,
    message: string,
    readonly statusCode: number,
    options: { readonly cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
  }
}
