/**
 * The Action's comment step: post `report.md` — or, when the tool broke
 * before a verdict, an explanation of that — as the sticky PR comment.
 *
 * Runs after `contextforge run` inside the composite action (action.yml). The
 * verdict itself travels as the run step's exit code, which is what sets the
 * check status; this step only reports it.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { REPORT_MARKER, renderToolError } from "@contextforge/cli";

import { pullRequestNumber, upsertComment } from "./comment.js";

export {
  findStickyComment,
  pullRequestNumber,
  upsertComment,
  type GitHubContext,
} from "./comment.js";

export interface CommentStepOptions {
  readonly reportPath: string;
  readonly errorLogPath: string;
  readonly env: Record<string, string | undefined>;
  readonly fetch?: typeof fetch;
  readonly log?: (line: string) => void;
}

async function readIfPresent(file: string): Promise<string | null> {
  return existsSync(file) ? readFile(file, "utf8") : null;
}

/** Build the comment body: the report if there is one, otherwise the tool's error. */
export async function commentBody(reportPath: string, errorLogPath: string): Promise<string> {
  const report = await readIfPresent(reportPath);
  if (report !== null) return report;
  const log =
    (await readIfPresent(errorLogPath)) ??
    "ContextForge exited without writing a report or an error log.";
  return renderToolError(log.trim().split("\n").slice(-40).join("\n"));
}

/**
 * Always resolves to 0: a comment that cannot be posted must not turn a
 * passing check red, nor hide a failing one. Problems are raised as workflow
 * warnings instead, so they are visible without changing the verdict.
 */
export async function commentStep(options: CommentStepOptions): Promise<number> {
  const log = options.log ?? ((line: string) => process.stdout.write(`${line}\n`));
  const { env } = options;

  const eventPath = env.GITHUB_EVENT_PATH;
  const event: unknown =
    eventPath === undefined ? null : JSON.parse((await readIfPresent(eventPath)) ?? "null");
  const issueNumber = pullRequestNumber(event);
  if (issueNumber === null) {
    log("not a pull request event; no comment to post");
    return 0;
  }

  const token = env.INPUT_GITHUB_TOKEN ?? env.GITHUB_TOKEN;
  const repository = env.GITHUB_REPOSITORY;
  if (!token || !repository) {
    log(
      "::warning::ContextForge cannot post its comment: GITHUB_TOKEN or GITHUB_REPOSITORY is missing",
    );
    return 0;
  }

  try {
    const outcome = await upsertComment(
      { apiUrl: env.GITHUB_API_URL ?? "https://api.github.com", token, repository, issueNumber },
      await commentBody(options.reportPath, options.errorLogPath),
      REPORT_MARKER,
      options.fetch,
    );
    log(`${outcome} the ContextForge comment on #${String(issueNumber)}`);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    log(`::warning::ContextForge could not post its comment: ${message}`);
  }
  return 0;
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const [reportPath = ".contextforge/report.md", errorLogPath = ".contextforge/error.log"] =
    process.argv.slice(2);
  process.exitCode = await commentStep({ reportPath, errorLogPath, env: process.env });
}
