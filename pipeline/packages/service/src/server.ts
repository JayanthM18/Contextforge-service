import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { GitHubAppClient } from "./github-app.js";
import { createWebhookServer } from "./http.js";
import { FileJobStore, FileReportStore, acquireServiceLock } from "./local-store.js";
import { LocalEvaluationWorker } from "./local-worker.js";
import { runEvaluationJob } from "./worker.js";
import { ServiceError } from "./errors.js";
import type { EvaluationJob, JobQueue, ServiceLogger } from "./types.js";

interface LocalServiceSettings {
  readonly appId: string;
  readonly privateKey: string;
  readonly webhookSecret: string;
  readonly repositoryName: string;
  readonly repositoryPath: string;
  readonly configPath: string;
  readonly dataDirectory: string;
  readonly cliPath: string;
  readonly publicUrl: string;
  readonly host: string;
  readonly port: number;
  readonly workerTimeoutMs: number;
  readonly environmentKeys: readonly string[];
  readonly environment: NodeJS.ProcessEnv;
}

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  if (value === undefined || value === "") {
    throw new ServiceError(
      "SERVICE_CONFIGURATION_INVALID",
      `${name} must be set before the local service can start.`,
      500,
    );
  }
  return value;
}

function listKeys(value: string | undefined, name: string): string[] {
  const keys = (value ?? "")
    .split(",")
    .map((key) => key.trim())
    .filter((key) => key !== "");
  const unique = [...new Set(keys)];
  for (const key of unique) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || /^(CONTEXTFORGE_|GITHUB_|RUNNER_)/i.test(key)) {
      throw new ServiceError(
        "SERVICE_CONFIGURATION_INVALID",
        `${name} contains a reserved or invalid environment variable name: ${key}.`,
        500,
      );
    }
  }
  return unique;
}

function positiveInteger(value: string | undefined, name: string, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new ServiceError(
      "SERVICE_CONFIGURATION_INVALID",
      `${name} must be a positive integer.`,
      500,
    );
  }
  return parsed;
}

function publicUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch (error: unknown) {
    throw new ServiceError(
      "SERVICE_CONFIGURATION_INVALID",
      "CONTEXTFORGE_PUBLIC_URL must be an absolute HTTPS URL.",
      500,
      { cause: error },
    );
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw new ServiceError(
      "SERVICE_CONFIGURATION_INVALID",
      "CONTEXTFORGE_PUBLIC_URL must be an HTTPS origin without credentials, path, query, or fragment.",
      500,
    );
  }
  return parsed.origin;
}

function settings(environment: NodeJS.ProcessEnv): LocalServiceSettings {
  const repositoryPath = path.resolve(required(environment, "CONTEXTFORGE_REPOSITORY_PATH"));
  const appKeys = listKeys(environment.CONTEXTFORGE_APP_ENV_KEYS, "CONTEXTFORGE_APP_ENV_KEYS");
  const evaluatorKeys = listKeys(
    environment.CONTEXTFORGE_EVALUATION_ENV_KEYS,
    "CONTEXTFORGE_EVALUATION_ENV_KEYS",
  );
  const environmentKeys = [...new Set([...appKeys, ...evaluatorKeys])];
  const repositoryName = required(environment, "CONTEXTFORGE_GITHUB_REPOSITORY");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repositoryName)) {
    throw new ServiceError(
      "SERVICE_CONFIGURATION_INVALID",
      "CONTEXTFORGE_GITHUB_REPOSITORY must be owner/name.",
      500,
    );
  }

  const configuredConfigPath = environment.CONTEXTFORGE_CONFIG_PATH?.trim();
  const configPath =
    configuredConfigPath === undefined || configuredConfigPath === ""
      ? "contextforge.yml"
      : configuredConfigPath;
  if (path.isAbsolute(configPath)) {
    throw new ServiceError(
      "SERVICE_CONFIGURATION_INVALID",
      "CONTEXTFORGE_CONFIG_PATH must be relative to the repository root.",
      500,
    );
  }

  const configuredDataDirectory = environment.CONTEXTFORGE_DATA_DIR?.trim();
  const configuredCliPath = environment.CONTEXTFORGE_CLI_PATH?.trim();
  const configuredHost = environment.CONTEXTFORGE_HOST?.trim();

  return {
    appId: required(environment, "GITHUB_APP_ID"),
    privateKey: required(environment, "GITHUB_APP_PRIVATE_KEY"),
    webhookSecret: required(environment, "CONTEXTFORGE_WEBHOOK_SECRET"),
    repositoryName: repositoryName.toLowerCase(),
    repositoryPath,
    configPath,
    dataDirectory: path.resolve(
      configuredDataDirectory === undefined || configuredDataDirectory === ""
        ? path.join(repositoryPath, ".contextforge", "service")
        : configuredDataDirectory,
    ),
    cliPath: path.resolve(
      configuredCliPath === undefined || configuredCliPath === ""
        ? path.resolve(
            path.dirname(fileURLToPath(import.meta.url)),
            "..",
            "..",
            "cli",
            "dist",
            "bin.js",
          )
        : configuredCliPath,
    ),
    publicUrl: publicUrl(required(environment, "CONTEXTFORGE_PUBLIC_URL")),
    host: configuredHost === undefined || configuredHost === "" ? "127.0.0.1" : configuredHost,
    port: positiveInteger(environment.CONTEXTFORGE_PORT, "CONTEXTFORGE_PORT", 3000),
    workerTimeoutMs: positiveInteger(
      environment.CONTEXTFORGE_WORKER_TIMEOUT_MS,
      "CONTEXTFORGE_WORKER_TIMEOUT_MS",
      4 * 60 * 60 * 1000,
    ),
    environmentKeys,
    environment,
  };
}

function logger(): ServiceLogger {
  return {
    error(message, fields = {}) {
      process.stderr.write(`${JSON.stringify({ level: "error", message, ...fields })}\n`);
    },
  };
}

function onlyConfiguredRepository(queue: JobQueue, allowedRepository: string): JobQueue {
  return {
    enqueueIfAbsent(job: EvaluationJob) {
      if (job.repository.fullName.toLowerCase() !== allowedRepository) {
        throw new ServiceError(
          "WEBHOOK_REPOSITORY_NOT_ALLOWED",
          "This local service is configured for a different GitHub repository.",
          403,
        );
      }
      return queue.enqueueIfAbsent(job);
    },
  };
}

function sleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, milliseconds);
    signal.addEventListener("abort", done, { once: true });

    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
  });
}

function isAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

async function workerLoop(
  store: FileJobStore,
  worker: LocalEvaluationWorker,
  checks: GitHubAppClient,
  reports: FileReportStore,
  serviceLogger: ServiceLogger,
  signal: AbortSignal,
): Promise<void> {
  while (!isAborted(signal)) {
    try {
      const jobs = await store.listPending();
      for (const job of jobs) {
        if (isAborted(signal)) break;
        try {
          await runEvaluationJob(job, {
            checks,
            executions: store,
            worker,
            reports,
            logger: serviceLogger,
          });
        } catch (error: unknown) {
          serviceLogger.error("Could not complete local evaluation job", {
            job_id: job.id,
            error_name: error instanceof Error ? error.name : "unknown",
            error_code: error instanceof ServiceError ? error.code : "UNEXPECTED",
          });
        }
      }
    } catch (error: unknown) {
      serviceLogger.error("Could not read the local evaluation queue", {
        error_name: error instanceof Error ? error.name : "unknown",
        error_code: error instanceof ServiceError ? error.code : "UNEXPECTED",
      });
    }
    await sleep(1000, signal);
  }
}

export async function startLocalService(environment = process.env): Promise<() => Promise<void>> {
  const config = settings(environment);
  const serviceLogger = logger();
  const releaseLock = await acquireServiceLock(config.dataDirectory);
  let closeServer: (() => Promise<void>) | undefined;
  let abortWorker: AbortController | undefined;
  let workerTask: Promise<void> | undefined;

  try {
    await access(config.repositoryPath);
    await access(config.cliPath);
    const store = await FileJobStore.create(config.dataDirectory);
    const reports = new FileReportStore(
      path.join(config.dataDirectory, "reports"),
      config.publicUrl,
    );
    const checks = new GitHubAppClient({
      appId: config.appId,
      privateKey: config.privateKey,
    });
    const worker = new LocalEvaluationWorker({
      repositoryPath: config.repositoryPath,
      repositoryName: config.repositoryName,
      configPath: config.configPath,
      dataDirectory: config.dataDirectory,
      cliPath: config.cliPath,
      timeoutMs: config.workerTimeoutMs,
      environmentKeys: config.environmentKeys,
      environment: config.environment,
      onProgress: (job, stage) => store.setProgress(job.id, stage),
    });
    const server = createWebhookServer(
      {
        webhookSecret: config.webhookSecret,
        jobs: onlyConfiguredRepository(store, config.repositoryName),
        logger: serviceLogger,
        acceptPush: false,
      },
      reports,
      store,
    );
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(config.port, config.host, resolve);
    });
    closeServer = () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error === undefined) resolve();
          else reject(error);
        });
      });
    abortWorker = new AbortController();
    workerTask = workerLoop(store, worker, checks, reports, serviceLogger, abortWorker.signal);
    process.stderr.write(
      `${JSON.stringify({
        level: "info",
        message: "ContextForge local GitHub App service listening",
        host: config.host,
        port: config.port,
        repository: config.repositoryName,
        public_url: config.publicUrl,
      })}\n`,
    );
  } catch (error: unknown) {
    if (closeServer !== undefined) await closeServer();
    if (abortWorker !== undefined) abortWorker.abort();
    if (workerTask !== undefined) await workerTask;
    await releaseLock();
    throw error;
  }

  let closed = false;
  return async () => {
    if (closed) return;
    closed = true;
    abortWorker.abort();
    await closeServer();
    await workerTask;
    await releaseLock();
  };
}

async function main(): Promise<void> {
  const close = await startLocalService();
  await new Promise<void>((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
  await close();
}

if (
  process.argv[1] !== undefined &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  void main().catch((error: unknown) => {
    process.stderr.write(
      `${JSON.stringify({
        level: "error",
        message: error instanceof Error ? error.message : "ContextForge service failed to start.",
      })}\n`,
    );
    process.exitCode = 1;
  });
}
