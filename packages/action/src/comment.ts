/**
 * The sticky pull-request comment: one comment per PR, found by a hidden
 * marker and edited in place on every push, never duplicated
 * (docs/DESIGN.md section 5).
 *
 * Plain `fetch` against the REST API: three calls do not justify a client
 * library (docs/RULES.md, "Dependencies are a decision").
 */

export interface GitHubContext {
  readonly apiUrl: string;
  readonly token: string;
  /** owner/name */
  readonly repository: string;
  readonly issueNumber: number;
}

interface Comment {
  readonly id: number;
  readonly body?: string | null;
}

export class GitHubError extends Error {
  override readonly name = "GitHubError";
  readonly code = "GITHUB_FAILED";

  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** The pull request number from a GitHub event payload, or null for other events. */
export function pullRequestNumber(event: unknown): number | null {
  if (typeof event !== "object" || event === null) return null;
  const pr = (event as { pull_request?: { number?: unknown } }).pull_request;
  return typeof pr?.number === "number" ? pr.number : null;
}

/** The id of the comment carrying `marker`, if there is one. */
export function findStickyComment(comments: readonly Comment[], marker: string): number | null {
  return comments.find((c) => typeof c.body === "string" && c.body.includes(marker))?.id ?? null;
}

async function call(
  ctx: GitHubContext,
  get: typeof fetch,
  method: string,
  path: string,
  body?: unknown,
): Promise<unknown> {
  const response = await get(`${ctx.apiUrl}${path}`, {
    method,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${ctx.token}`,
      "x-github-api-version": "2022-11-28",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    const hint =
      response.status === 403
        ? " — the token cannot write comments; pull requests from forks get a read-only token"
        : "";
    throw new GitHubError(
      `${method} ${path} returned ${String(response.status)}${hint}: ${detail}`,
      response.status,
    );
  }
  return response.json();
}

export async function upsertComment(
  ctx: GitHubContext,
  body: string,
  marker: string,
  get: typeof fetch = fetch,
): Promise<"created" | "updated"> {
  const base = `/repos/${ctx.repository}/issues`;

  // Busy pull requests can have hundreds of comments; page through them.
  let existing: number | null = null;
  for (let page = 1; page <= 20 && existing === null; page += 1) {
    const batch = (await call(
      ctx,
      get,
      "GET",
      `${base}/${String(ctx.issueNumber)}/comments?per_page=100&page=${String(page)}`,
    )) as Comment[];
    existing = findStickyComment(batch, marker);
    if (batch.length < 100) break;
  }

  if (existing !== null) {
    await call(ctx, get, "PATCH", `${base}/comments/${String(existing)}`, { body });
    return "updated";
  }
  await call(ctx, get, "POST", `${base}/${String(ctx.issueNumber)}/comments`, { body });
  return "created";
}
