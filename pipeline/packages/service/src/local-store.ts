import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { ServiceError } from "./errors.js";
import type {
  EnqueuedJob,
  DashboardJob,
  DashboardReader,
  EvaluationJob,
  JobClaim,
  JobCompletion,
  JobExecutionStore,
  JobQueue,
  ReportReader,
  ReportStore,
} from "./types.js";

const jobSchema = z.object({
  id: z.string().min(1),
  deliveryId: z.string().min(1),
  installationId: z.number().int().positive(),
  repository: z.object({
    owner: z.string().min(1),
    name: z.string().min(1),
    fullName: z.string().min(1),
    cloneUrl: z.url(),
  }),
  commitSha: z.string().regex(/^[0-9a-f]{40}$/i),
  ref: z.string().min(1),
  pullRequestNumber: z.number().int().positive().nullable(),
  baseSha: z
    .string()
    .regex(/^[0-9a-f]{40}$/i)
    .nullable(),
  isFork: z.boolean(),
  secretsAllowed: z.boolean(),
});

const resultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.enum(["pass", "regression"]), reportUrl: z.url() }),
  z.object({
    status: z.literal("tool_error"),
    code: z.string().min(1),
    safeMessage: z.string().min(1),
  }),
]);

const completionSchema = z.object({
  checkRunId: z.number().int().positive(),
  result: resultSchema,
  notificationsDelivered: z.boolean().default(false),
});

const progressSchema = z.object({
  stage: z.string().min(1).max(100),
  updatedAt: z.string().datetime(),
});

const stateSchema = z.object({
  jobs: z.array(jobSchema),
  active: z.array(z.string()),
  completions: z.record(z.string(), completionSchema),
  progress: z.record(z.string(), progressSchema).default({}),
});

type StoreState = z.infer<typeof stateSchema>;

const emptyState = (): StoreState => ({ jobs: [], active: [], completions: {}, progress: {} });

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function acquireServiceLock(dataDirectory: string): Promise<() => Promise<void>> {
  await mkdir(dataDirectory, { recursive: true });
  const lockPath = path.join(dataDirectory, "service.lock");

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(lockPath, "wx");
      await handle.writeFile(`${String(process.pid)}\n`, "utf8");
      return async () => {
        await handle.close();
        const content = await readFile(lockPath, "utf8");
        if (content.trim() === String(process.pid)) await rm(lockPath, { force: true });
      };
    } catch (error: unknown) {
      if (
        !isMissingFile(error) &&
        !(error instanceof Error && "code" in error && error.code === "EEXIST")
      ) {
        throw error;
      }
      if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;

      const content = await readFile(lockPath, "utf8").catch((readError: unknown) => {
        if (isMissingFile(readError)) return "";
        throw readError;
      });
      const pid = Number(content.trim());
      if (!Number.isSafeInteger(pid) || pid <= 0) {
        throw new ServiceError(
          "SERVICE_ALREADY_RUNNING",
          `Cannot determine whether ${lockPath} belongs to a running service. Remove the stale lock only after verifying no ContextForge service is active.`,
          500,
        );
      }
      try {
        process.kill(pid, 0);
      } catch (probeError: unknown) {
        if (probeError instanceof Error && "code" in probeError && probeError.code === "ESRCH") {
          await rm(lockPath, { force: true });
          continue;
        }
        throw new ServiceError(
          "SERVICE_ALREADY_RUNNING",
          `Another ContextForge service may already be using ${dataDirectory}.`,
          500,
          { cause: probeError },
        );
      }
      throw new ServiceError(
        "SERVICE_ALREADY_RUNNING",
        `Another ContextForge service is already using ${dataDirectory}.`,
        500,
      );
    }
  }

  throw new ServiceError("SERVICE_ALREADY_RUNNING", "Could not acquire the service lock.", 500);
}

export class FileJobStore implements JobQueue, JobExecutionStore, DashboardReader {
  private tail: Promise<void> = Promise.resolve();

  private constructor(private readonly statePath: string) {}

  static async create(dataDirectory: string): Promise<FileJobStore> {
    await mkdir(dataDirectory, { recursive: true });
    const store = new FileJobStore(path.join(dataDirectory, "jobs.json"));
    await store.exclusive(async () => {
      const state = await store.load();
      state.active = [];
      await store.save(state);
    });
    return store;
  }

  async listPending(): Promise<readonly EvaluationJob[]> {
    const state = await this.load();
    return state.jobs.filter((job) => {
      const completion = state.completions[job.id];
      return !state.active.includes(job.id) && !completion?.notificationsDelivered;
    });
  }

  async listDashboardJobs(): Promise<readonly DashboardJob[]> {
    const state = await this.load();
    return state.jobs
      .slice()
      .reverse()
      .slice(0, 50)
      .map((job) => {
        const completion = state.completions[job.id];
        const status = completion
          ? "completed"
          : state.active.includes(job.id)
            ? "running"
            : "queued";
        return {
          repository: job.repository.fullName,
          commitSha: job.commitSha,
          pullRequestNumber: job.pullRequestNumber,
          status,
          stage:
            state.progress[job.id]?.stage ??
            (status === "queued"
              ? "Queued"
              : status === "running"
                ? "Starting evaluation"
                : completion?.result.status === "pass"
                  ? "Passed"
                  : completion?.result.status === "regression"
                    ? "Regression found"
                    : "Evaluation failed"),
          result: completion?.result ?? null,
        };
      });
  }

  enqueueIfAbsent(job: EvaluationJob): Promise<EnqueuedJob> {
    return this.exclusive(async () => {
      const state = await this.load();
      const existing = state.jobs.find(
        (queued) => queued.id === job.id || queued.deliveryId === job.deliveryId,
      );
      if (existing !== undefined) return { job: existing, created: false };
      const validated = jobSchema.parse(job);
      state.jobs.push(validated);
      state.progress[validated.id] = { stage: "Queued", updatedAt: new Date().toISOString() };
      await this.save(state);
      return { job: validated, created: true };
    });
  }

  claim(jobId: string): Promise<JobClaim> {
    return this.exclusive(async () => {
      const state = await this.load();
      const completion = state.completions[jobId];
      if (completion !== undefined) {
        if (state.active.includes(jobId)) return { status: "busy" };
        if (!completion.notificationsDelivered) {
          state.active.push(jobId);
          await this.save(state);
        }
        return { status: "completed", completion };
      }
      if (!state.jobs.some((job) => job.id === jobId)) {
        throw new ServiceError("JOB_NOT_FOUND", `Evaluation job ${jobId} is not queued.`, 404);
      }
      if (state.active.includes(jobId)) return { status: "busy" };
      state.active.push(jobId);
      state.progress[jobId] = { stage: "Starting evaluation", updatedAt: new Date().toISOString() };
      await this.save(state);
      return { status: "acquired" };
    });
  }

  saveCompletion(jobId: string, completion: JobCompletion): Promise<void> {
    return this.exclusive(async () => {
      const state = await this.load();
      if (!state.jobs.some((job) => job.id === jobId)) {
        throw new ServiceError("JOB_NOT_FOUND", `Evaluation job ${jobId} is not queued.`, 404);
      }
      state.completions[jobId] = completionSchema.parse(completion);
      state.progress[jobId] = {
        stage:
          completion.result.status === "pass"
            ? "Passed"
            : completion.result.status === "regression"
              ? "Regression found"
              : "Evaluation failed",
        updatedAt: new Date().toISOString(),
      };
      await this.save(state);
    });
  }

  markNotificationsDelivered(jobId: string): Promise<void> {
    return this.exclusive(async () => {
      const state = await this.load();
      const completion = state.completions[jobId];
      if (completion === undefined) {
        throw new ServiceError(
          "JOB_NOT_COMPLETED",
          `Evaluation job ${jobId} has no saved completion to deliver.`,
          409,
        );
      }
      state.completions[jobId] = { ...completion, notificationsDelivered: true };
      state.active = state.active.filter((activeId) => activeId !== jobId);
      await this.save(state);
    });
  }

  release(jobId: string): Promise<void> {
    return this.exclusive(async () => {
      const state = await this.load();
      state.active = state.active.filter((activeId) => activeId !== jobId);
      await this.save(state);
    });
  }

  async setProgress(jobId: string, stage: string): Promise<void> {
    return this.exclusive(async () => {
      const state = await this.load();
      if (!state.jobs.some((job) => job.id === jobId)) {
        throw new ServiceError("JOB_NOT_FOUND", `Evaluation job ${jobId} is not queued.`, 404);
      }
      state.progress[jobId] = progressSchema.parse({ stage, updatedAt: new Date().toISOString() });
      await this.save(state);
    });
  }

  private async load(): Promise<StoreState> {
    let text: string;
    try {
      text = await readFile(this.statePath, "utf8");
    } catch (error: unknown) {
      if (isMissingFile(error)) return emptyState();
      throw error;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch (error: unknown) {
      throw new ServiceError(
        "LOCAL_STATE_INVALID",
        `Local job state ${this.statePath} is not valid JSON.`,
        500,
        { cause: error },
      );
    }
    const result = stateSchema.safeParse(parsed);
    if (!result.success) {
      throw new ServiceError(
        "LOCAL_STATE_INVALID",
        `Local job state ${this.statePath} does not match the expected schema.`,
        500,
        { cause: result.error },
      );
    }
    return result.data;
  }

  private async save(state: StoreState): Promise<void> {
    const temporaryPath = `${this.statePath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, `${JSON.stringify(state)}\n`, { flag: "wx" });
      await rename(temporaryPath, this.statePath);
    } finally {
      await rm(temporaryPath, { force: true });
    }
  }

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation, operation);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

export class FileReportStore implements ReportStore, ReportReader {
  constructor(
    private readonly reportDirectory: string,
    private readonly publicUrl: string,
  ) {}

  async put(_job: EvaluationJob, markdown: string, json: string): Promise<string> {
    await mkdir(this.reportDirectory, { recursive: true });
    const id = randomBytes(32).toString("hex");
    const document = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>ContextForge evaluation report</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:1000px;margin:2rem auto;padding:0 1rem}pre{white-space:pre-wrap;overflow-wrap:anywhere}details{margin-top:2rem}</style></head>
<body><h1>ContextForge evaluation report</h1><pre>${escapeHtml(markdown)}</pre>
<details><summary>Raw results</summary><pre>${escapeHtml(json)}</pre></details></body></html>`;
    await writeFile(path.join(this.reportDirectory, `${id}.html`), document, {
      encoding: "utf8",
      flag: "wx",
    });
    return new URL(`/reports/${id}`, this.publicUrl).toString();
  }

  async read(id: string): Promise<string | null> {
    try {
      return await readFile(path.join(this.reportDirectory, `${id}.html`), "utf8");
    } catch (error: unknown) {
      if (isMissingFile(error)) return null;
      throw error;
    }
  }
}
