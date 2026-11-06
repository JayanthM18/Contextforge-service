import { ServiceError } from "./errors.js";
import type {
  CheckRunResult,
  EvaluationJob,
  EvaluationJobDependencies,
  EvaluationOutcome,
  JobCompletion,
} from "./types.js";

export async function runEvaluationJob(
  job: EvaluationJob,
  dependencies: EvaluationJobDependencies,
): Promise<void> {
  const claim = await dependencies.executions.claim(job.id);
  if (claim.status === "busy") return;
  if (claim.status === "completed") {
    try {
      await publishResult(job, claim.completion, dependencies);
    } catch (error: unknown) {
      await dependencies.executions.release(job.id);
      throw error;
    }
    return;
  }

  let checkRunId: number | undefined;
  try {
    checkRunId = await dependencies.checks.createQueued(job);
    await dependencies.checks.start(job, checkRunId);

    let outcome: EvaluationOutcome;
    try {
      outcome = await dependencies.worker.evaluate(job);
    } catch (error: unknown) {
      dependencies.logger.error("Isolated evaluation failed", {
        job_id: job.id,
        error_name: error instanceof Error ? error.name : "unknown",
      });
      outcome = {
        status: "tool_error",
        code: error instanceof ServiceError ? error.code : "WORKER_FAILED",
        safeMessage:
          "ContextForge could not complete this evaluation. Review service logs or retry.",
      };
    }

    let result: CheckRunResult;
    if (outcome.status === "tool_error") {
      result = outcome;
    } else {
      try {
        const reportUrl = await dependencies.reports.put(
          job,
          outcome.reportMarkdown,
          outcome.reportJson,
        );
        if (new URL(reportUrl).protocol !== "https:") {
          throw new ServiceError(
            "SERVICE_CONFIGURATION_INVALID",
            "Report storage must return an HTTPS access-controlled URL.",
            500,
          );
        }
        result = { status: outcome.status, reportUrl };
      } catch (error: unknown) {
        dependencies.logger.error("Could not persist evaluation report", {
          job_id: job.id,
          error_name: error instanceof Error ? error.name : "unknown",
        });
        result = {
          status: "tool_error",
          code: "REPORT_STORAGE_FAILED",
          safeMessage:
            "ContextForge could not persist the evaluation report. Review service logs or retry.",
        };
      }
    }

    const completion: JobCompletion = {
      checkRunId,
      result,
      notificationsDelivered: false,
    };
    await dependencies.executions.saveCompletion(job.id, completion);
    await publishResult(job, completion, dependencies);
  } catch (error: unknown) {
    await dependencies.executions.release(job.id);
    throw error;
  }
}

async function publishResult(
  job: EvaluationJob,
  completion: JobCompletion,
  dependencies: EvaluationJobDependencies,
): Promise<void> {
  await dependencies.checks.complete(job, completion.checkRunId, completion.result);
  await dependencies.checks.publishPullRequestResult(job, completion.result);
  await dependencies.executions.markNotificationsDelivered(job.id);
}
