import { z } from "zod";

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

const repositoryShape = z.object({
  full_name: z.string().min(1),
  owner: z.object({ login: z.string().regex(/^[A-Za-z0-9_.-]+$/) }),
  name: z.string().regex(/^[A-Za-z0-9_.-]+$/),
  clone_url: z.url().refine((value) => new URL(value).protocol === "https:"),
});

function validateFullName(
  repository: { full_name: string; owner: { login: string }; name: string },
  ctx: z.RefinementCtx,
): void {
  if (
    repository.full_name.toLowerCase() !==
    `${repository.owner.login}/${repository.name}`.toLowerCase()
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["full_name"],
      message: "must match owner.login/name",
    });
  }
}

export const repositorySchema = repositoryShape.superRefine(validateFullName);
const pushRepositorySchema = repositoryShape
  .extend({ default_branch: z.string().min(1) })
  .superRefine(validateFullName);

export const pullRequestEventSchema = z.object({
  action: z.string(),
  installation: z.object({ id: z.number().int().positive() }),
  repository: repositorySchema,
  pull_request: z.object({
    number: z.number().int().positive(),
    head: z.object({
      sha: z.string().regex(/^[0-9a-f]{40}$/i),
      ref: z.string().min(1),
      repo: repositorySchema.nullable(),
    }),
    base: z.object({
      sha: z.string().regex(/^[0-9a-f]{40}$/i),
      ref: z.string().min(1),
    }),
  }),
});

export const pushEventSchema = z.object({
  installation: z.object({ id: z.number().int().positive() }),
  repository: pushRepositorySchema,
  ref: z
    .string()
    .refine(
      (value) => value.startsWith("refs/heads/") && !hasControlCharacter(value),
      "must be a valid refs/heads branch name",
    ),
  after: z.string().regex(/^[0-9a-f]{40}$/i),
  deleted: z.boolean().optional(),
});

export interface EvaluationJob {
  readonly id: string;
  readonly deliveryId: string;
  readonly installationId: number;
  readonly repository: {
    readonly owner: string;
    readonly name: string;
    readonly fullName: string;
    readonly cloneUrl: string;
  };
  /** Full immutable Git commit selected by the GitHub event. */
  readonly commitSha: string;
  /** Event ref for reporting only; workers must not resolve this mutable ref. */
  readonly ref: string;
  readonly pullRequestNumber: number | null;
  readonly baseSha: string | null;
  readonly isFork: boolean;
  readonly secretsAllowed: boolean;
}

export interface EnqueuedJob {
  readonly job: EvaluationJob;
  readonly created: boolean;
}

export interface JobQueue {
  /** Atomically deduplicate by delivery id and job id before making the job visible to workers. */
  enqueueIfAbsent(job: EvaluationJob): Promise<EnqueuedJob>;
}

export type EvaluationOutcome =
  | {
      readonly status: "pass" | "regression";
      readonly reportMarkdown: string;
      readonly reportJson: string;
    }
  | {
      readonly status: "tool_error";
      readonly code: string;
      readonly safeMessage: string;
    };

export interface EvaluationWorker {
  /**
   * Must provision and destroy a disposable isolated VM, checkout exactly
   * `job.commitSha`, and run the evaluator from the deployed service release.
   * It must never use a mutable ref or the ContextForge developer workspace.
   */
  evaluate(job: EvaluationJob): Promise<EvaluationOutcome>;
}

export interface ReportStore {
  /** Persist report content in ContextForge-managed storage and return an access-controlled URL. */
  put(job: EvaluationJob, markdown: string, json: string): Promise<string>;
}

export interface ReportReader {
  read(id: string): Promise<string | null>;
}

export interface CheckRunPublisher {
  createQueued(job: EvaluationJob): Promise<number>;
  start(job: EvaluationJob, checkRunId: number): Promise<void>;
  complete(
    job: EvaluationJob,
    checkRunId: number,
    result:
      | { readonly status: "pass" | "regression"; readonly reportUrl: string }
      | { readonly status: "tool_error"; readonly code: string; readonly safeMessage: string },
  ): Promise<void>;
  publishPullRequestResult(job: EvaluationJob, result: CheckRunResult): Promise<void>;
}

export type CheckRunResult =
  | { readonly status: "pass" | "regression"; readonly reportUrl: string }
  | { readonly status: "tool_error"; readonly code: string; readonly safeMessage: string };

export interface JobCompletion {
  readonly checkRunId: number;
  readonly result: CheckRunResult;
  readonly notificationsDelivered: boolean;
}

export type JobClaim =
  | { readonly status: "acquired" }
  | { readonly status: "busy" }
  | { readonly status: "completed"; readonly completion: JobCompletion };

export interface JobExecutionStore {
  /** Atomically lease a job or return its persisted completion for retry-safe delivery. */
  claim(jobId: string): Promise<JobClaim>;
  saveCompletion(jobId: string, completion: JobCompletion): Promise<void>;
  markNotificationsDelivered(jobId: string): Promise<void>;
  release(jobId: string): Promise<void>;
}

export interface ServiceLogger {
  error(message: string, fields?: Record<string, unknown>): void;
}

export interface WebhookDependencies {
  readonly webhookSecret: string;
  readonly jobs: JobQueue;
  readonly logger: ServiceLogger;
  readonly acceptPush?: boolean;
}

export interface EvaluationJobDependencies {
  readonly checks: CheckRunPublisher;
  readonly executions: JobExecutionStore;
  readonly worker: EvaluationWorker;
  readonly reports: ReportStore;
  readonly logger: ServiceLogger;
}
