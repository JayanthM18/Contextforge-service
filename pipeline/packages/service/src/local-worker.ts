import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { EvaluationJob, EvaluationOutcome, EvaluationWorker } from "./types.js";
import { ServiceError } from "./errors.js";

interface ProcessResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

interface ProcessOptions {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly timeoutMs: number;
  readonly onStderrLine?: (line: string) => void;
}

const OUTPUT_LIMIT = 2 * 1024 * 1024;
const SHA_PATTERN = /^[0-9a-f]{40}$/i;

function runProcess(
  command: string,
  args: readonly string[],
  options: ProcessOptions,
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let stderrLine = "";
    let outputBytes = 0;
    let failure: Error | undefined;
    const timer = setTimeout(() => {
      failure = new Error("process timed out");
      child.kill();
    }, options.timeoutMs);
    const collect = (target: "stdout" | "stderr", chunk: Buffer) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > OUTPUT_LIMIT) {
        failure = new Error("process output limit exceeded");
        child.kill();
        return;
      }
      const text = chunk.toString("utf8");
      if (target === "stdout") stdout += text;
      else {
        stderr += text;
        stderrLine += text;
        const lines = stderrLine.split("\n");
        stderrLine = lines.pop() ?? "";
        for (const line of lines) options.onStderrLine?.(line);
      }
    };

    child.stdout.on("data", (chunk: Buffer) => {
      collect("stdout", chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      collect("stderr", chunk);
    });
    child.once("error", (error: Error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (failure !== undefined) {
        reject(failure);
        return;
      }
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

function safeEnvironment(
  source: NodeJS.ProcessEnv,
  allowedKeys: readonly string[],
): NodeJS.ProcessEnv {
  const keys = new Set([
    "PATH",
    "HOME",
    "USER",
    "LANG",
    "TMPDIR",
    "XDG_RUNTIME_DIR",
    "DOCKER_HOST",
    "DOCKER_CONFIG",
    "DOCKER_CONTEXT",
    "DOCKER_CERT_PATH",
    "DOCKER_TLS_VERIFY",
    "SSH_AUTH_SOCK",
    "SystemRoot",
    "WINDIR",
    "PATHEXT",
    "TEMP",
    "TMP",
    ...allowedKeys,
  ]);
  return Object.fromEntries(
    [...keys].filter((name) => source[name] !== undefined).map((name) => [name, source[name]]),
  );
}

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 100);
}

export interface LocalWorkerOptions {
  readonly repositoryPath: string;
  readonly repositoryName: string;
  readonly configPath: string;
  readonly dataDirectory: string;
  readonly cliPath: string;
  readonly timeoutMs: number;
  readonly environmentKeys: readonly string[];
  readonly environment: NodeJS.ProcessEnv;
  readonly onProgress?: (job: EvaluationJob, stage: string) => Promise<void>;
}

export class LocalEvaluationWorker implements EvaluationWorker {
  constructor(private readonly options: LocalWorkerOptions) {}

  private reportProgress(job: EvaluationJob, stage: string): Promise<void> {
    return this.options.onProgress?.(job, stage) ?? Promise.resolve();
  }

  async evaluate(job: EvaluationJob): Promise<EvaluationOutcome> {
    if (job.pullRequestNumber === null || job.baseSha === null) {
      throw new ServiceError(
        "LOCAL_JOB_UNSUPPORTED",
        "The local evaluation service accepts pull-request jobs only.",
        400,
      );
    }
    if (job.isFork || !job.secretsAllowed) {
      throw new ServiceError(
        "LOCAL_FORK_DISABLED",
        "Fork pull requests are disabled by the trusted-repository local execution policy.",
        403,
      );
    }
    if (job.repository.fullName.toLowerCase() !== this.options.repositoryName.toLowerCase()) {
      throw new ServiceError(
        "LOCAL_REPOSITORY_MISMATCH",
        "The evaluation job repository does not match the locally configured repository.",
        403,
      );
    }
    if (!SHA_PATTERN.test(job.commitSha) || !SHA_PATTERN.test(job.baseSha)) {
      throw new ServiceError(
        "LOCAL_JOB_INVALID",
        "The pull-request webhook did not provide full commit identifiers.",
        400,
      );
    }

    await this.reportProgress(job, "Checking local repository");
    const repositoryRoot = await this.repositoryRoot();
    const remote = await this.git(repositoryRoot, ["config", "--get", "remote.origin.url"]);
    if (this.remoteRepositoryName(remote) !== this.options.repositoryName.toLowerCase()) {
      throw new ServiceError(
        "LOCAL_REPOSITORY_MISMATCH",
        "The local repository origin does not match CONTEXTFORGE_GITHUB_REPOSITORY.",
        500,
      );
    }
    await this.reportProgress(job, "Fetching pull-request commit");
    await this.fetchCommits(repositoryRoot, job.commitSha, job.baseSha);
    const mergeBase = await this.mergeBase(repositoryRoot, job.commitSha, job.baseSha);
    const worktreeParent = await mkdtemp(path.join(os.tmpdir(), "contextforge-local-job-"));
    const checkout = path.join(worktreeParent, "checkout");
    const outputDirectory = path.join(
      this.options.dataDirectory,
      "runs",
      safeName(job.id),
      randomUUID(),
    );

    let worktreeAdded = false;
    let evaluationFailed = false;
    let evaluationFailure: unknown;
    let outcome: EvaluationOutcome | undefined;
    const cleanupFailures: unknown[] = [];
    try {
      await this.reportProgress(job, "Creating clean checkout");
      await mkdir(outputDirectory, { recursive: true });
      await this.git(repositoryRoot, ["worktree", "add", "--detach", checkout, job.commitSha]);
      worktreeAdded = true;
      const actualHead = await this.git(checkout, ["rev-parse", "HEAD"]);
      if (actualHead.toLowerCase() !== job.commitSha.toLowerCase()) {
        throw new ServiceError(
          "LOCAL_CHECKOUT_MISMATCH",
          "The local Git checkout does not match the pull-request commit SHA.",
          500,
        );
      }

      const configPath = this.configInCheckout(checkout);
      let progressTail = Promise.resolve();
      const updateFromOutput = (line: string) => {
        const stage =
          line.includes("building and starting the app")
            ? "Building application container"
            : line.includes("app is healthy; asking every question")
              ? "Querying RAG application"
              : line.includes("pausing between request batches")
                ? "Waiting for model rate limit"
                : line.includes("scoring")
                  ? "Scoring answers with judge"
                  : line.includes("verdict:")
                    ? "Finalizing evaluation"
                    : null;
        if (stage !== null) progressTail = progressTail.then(() => this.reportProgress(job, stage));
      };
      await this.reportProgress(job, "Starting evaluation pipeline");
      const result = await runProcess(
        process.execPath,
        [
          this.options.cliPath,
          "run",
          "--config",
          configPath,
          "--candidate",
          job.commitSha,
          "--baseline",
          mergeBase,
          "--output",
          outputDirectory,
        ],
        {
          cwd: checkout,
          env: safeEnvironment(this.options.environment, this.options.environmentKeys),
          timeoutMs: this.options.timeoutMs,
          onStderrLine: updateFromOutput,
        },
      );
      await progressTail;
      if (result.code !== 0 && result.code !== 1) {
        throw new ServiceError(
          "LOCAL_EVALUATION_FAILED",
          `The evaluation CLI exited with status ${String(result.code)}. Check the local service log for its output.`,
          500,
        );
      }

      await this.reportProgress(job, "Reading evaluation report");
      const [reportMarkdown, reportJson] = await Promise.all([
        readFile(path.join(outputDirectory, "report.md"), "utf8"),
        readFile(path.join(outputDirectory, "results.json"), "utf8"),
      ]);
      const parsed: unknown = JSON.parse(reportJson);
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        !("verdict" in parsed) ||
        typeof parsed.verdict !== "object" ||
        parsed.verdict === null ||
        !("status" in parsed.verdict) ||
        (parsed.verdict.status !== "pass" && parsed.verdict.status !== "fail")
      ) {
        throw new ServiceError(
          "LOCAL_EVALUATION_INVALID",
          "The evaluation CLI wrote a results file without a valid verdict.",
          500,
        );
      }

      outcome = {
        status: parsed.verdict.status === "pass" ? "pass" : "regression",
        reportMarkdown,
        reportJson,
      };
    } catch (error: unknown) {
      evaluationFailed = true;
      evaluationFailure =
        error instanceof ServiceError
          ? error
          : new ServiceError(
              "LOCAL_EVALUATION_FAILED",
              "The local evaluation could not complete. Check the service log and repository remote.",
              500,
              { cause: error },
            );
    } finally {
      if (worktreeAdded) {
        try {
          await this.git(repositoryRoot, ["worktree", "remove", "--force", checkout]);
        } catch (error: unknown) {
          cleanupFailures.push(error);
        }
      }
      for (const temporaryPath of [worktreeParent, outputDirectory]) {
        try {
          await rm(temporaryPath, { recursive: true, force: true });
        } catch (error: unknown) {
          cleanupFailures.push(error);
        }
      }
    }

    if (evaluationFailed) {
      if (cleanupFailures.length > 0) {
        throw new ServiceError(
          "LOCAL_EVALUATION_FAILED",
          "The local evaluation failed and temporary data could not be fully removed.",
          500,
          { cause: new AggregateError([evaluationFailure, ...cleanupFailures]) },
        );
      }
      throw evaluationFailure;
    }
    if (cleanupFailures.length > 0) {
      throw new ServiceError(
        "LOCAL_WORKTREE_CLEANUP_FAILED",
        "Could not remove temporary evaluation data.",
        500,
        { cause: new AggregateError(cleanupFailures) },
      );
    }
    if (outcome === undefined) {
      throw new ServiceError(
        "LOCAL_EVALUATION_INVALID",
        "The local evaluation completed without producing an outcome.",
        500,
      );
    }
    return outcome;
  }

  private configInCheckout(checkout: string): string {
    if (path.isAbsolute(this.options.configPath)) {
      throw new ServiceError(
        "SERVICE_CONFIGURATION_INVALID",
        "CONTEXTFORGE_CONFIG_PATH must be relative to the repository root.",
        500,
      );
    }
    const configPath = path.resolve(checkout, this.options.configPath);
    const relative = path.relative(checkout, configPath);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new ServiceError(
        "SERVICE_CONFIGURATION_INVALID",
        "CONTEXTFORGE_CONFIG_PATH must remain inside the target repository.",
        500,
      );
    }
    return configPath;
  }

  private async repositoryRoot(): Promise<string> {
    const configuredRoot = path.resolve(this.options.repositoryPath);
    const result = await this.git(configuredRoot, ["rev-parse", "--show-toplevel"]);
    const root = path.resolve(result);
    if (root !== configuredRoot) {
      throw new ServiceError(
        "SERVICE_CONFIGURATION_INVALID",
        "CONTEXTFORGE_REPOSITORY_PATH must point to the Git repository root.",
        500,
      );
    }
    return root;
  }

  private async fetchCommits(repositoryRoot: string, commitSha: string, baseSha: string) {
    const shallow = await this.git(repositoryRoot, ["rev-parse", "--is-shallow-repository"]);
    if (shallow === "true") {
      await this.git(repositoryRoot, ["fetch", "--unshallow", "origin"], 10 * 60_000);
    }
    await this.git(repositoryRoot, ["fetch", "--no-tags", "origin", commitSha, baseSha], 120_000);
    await this.git(repositoryRoot, ["cat-file", "-e", `${commitSha}^{commit}`]);
    await this.git(repositoryRoot, ["cat-file", "-e", `${baseSha}^{commit}`]);
  }

  private remoteRepositoryName(remote: string): string | null {
    let url: URL;
    try {
      url = new URL(remote);
    } catch {
      const ssh = /^(?:[^@]+@)?github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/i.exec(remote);
      return ssh?.[1]?.toLowerCase() ?? null;
    }
    if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "github.com") return null;
    return url.pathname
      .replace(/^\/|\/$/g, "")
      .replace(/\.git$/i, "")
      .toLowerCase();
  }

  private async mergeBase(repositoryRoot: string, commitSha: string, baseSha: string) {
    const sha = await this.git(repositoryRoot, ["merge-base", commitSha, baseSha]);
    if (!SHA_PATTERN.test(sha)) {
      throw new ServiceError(
        "LOCAL_MERGE_BASE_FAILED",
        "Git did not return a valid merge-base commit for the pull request.",
        500,
      );
    }
    return sha;
  }

  private async git(cwd: string, args: readonly string[], timeoutMs = 30_000): Promise<string> {
    try {
      const result = await runProcess("git", ["-C", cwd, ...args], {
        env: this.options.environment,
        timeoutMs,
      });
      if (result.code !== 0) {
        throw new ServiceError(
          "LOCAL_GIT_FAILED",
          `A local Git operation failed with status ${String(result.code)}.`,
          500,
        );
      }
      return result.stdout.trim();
    } catch (error: unknown) {
      if (error instanceof ServiceError) throw error;
      throw new ServiceError("LOCAL_GIT_FAILED", "A local Git operation could not start.", 500, {
        cause: error,
      });
    }
  }
}
