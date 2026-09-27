import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { REPORT_MARKER } from "@contextforge/cli";
import { describe, expect, it } from "vitest";

import { findStickyComment, pullRequestNumber, upsertComment } from "../src/comment.js";
import { commentBody, commentStep } from "../src/index.js";

const ctx = { apiUrl: "https://api.github.test", token: "t", repository: "o/r", issueNumber: 7 };

interface Call {
  method: string;
  url: string;
  body: unknown;
}

/** A fake GitHub holding one pull request's comments. */
function github(initial: { id: number; body: string }[] = [], status = 200) {
  const comments = [...initial];
  const calls: Call[] = [];
  const fake: typeof fetch = (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? "GET";
    const body: unknown = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ method, url, body });
    if (status !== 200) return Promise.resolve(new Response("forbidden", { status }));

    const text = (body as { body?: string } | undefined)?.body ?? "";
    if (method === "GET") {
      const page = Number(new URL(url).searchParams.get("page") ?? "1");
      return Promise.resolve(Response.json(comments.slice((page - 1) * 100, page * 100)));
    }
    if (method === "POST") comments.push({ id: comments.length + 1000, body: text });
    if (method === "PATCH") {
      const id = Number(url.split("/").pop());
      const existing = comments.find((c) => c.id === id);
      if (existing) existing.body = text;
    }
    return Promise.resolve(Response.json({}));
  };
  return { fake, calls, comments };
}

describe("pullRequestNumber", () => {
  it("reads the number from a pull_request event", () => {
    expect(pullRequestNumber({ pull_request: { number: 42 } })).toBe(42);
  });

  it("is null for other events", () => {
    expect(pullRequestNumber({ ref: "refs/heads/main" })).toBeNull();
    expect(pullRequestNumber(null)).toBeNull();
  });
});

describe("findStickyComment", () => {
  it("finds the comment carrying the marker among others", () => {
    expect(
      findStickyComment(
        [
          { id: 1, body: "lgtm" },
          { id: 2, body: `${REPORT_MARKER}\nold` },
        ],
        REPORT_MARKER,
      ),
    ).toBe(2);
  });

  it("ignores comments without a body", () => {
    expect(findStickyComment([{ id: 1, body: null }], REPORT_MARKER)).toBeNull();
  });
});

describe("upsertComment", () => {
  it("creates the comment on the first push", async () => {
    const gh = github([{ id: 1, body: "a human comment" }]);

    expect(await upsertComment(ctx, `${REPORT_MARKER}\nv1`, REPORT_MARKER, gh.fake)).toBe(
      "created",
    );
    expect(gh.comments).toHaveLength(2);
  });

  it("updates rather than duplicates on later pushes (the stage 8 gate)", async () => {
    const gh = github();
    await upsertComment(ctx, `${REPORT_MARKER}\nv1`, REPORT_MARKER, gh.fake);
    await upsertComment(ctx, `${REPORT_MARKER}\nv2`, REPORT_MARKER, gh.fake);
    await upsertComment(ctx, `${REPORT_MARKER}\nv3`, REPORT_MARKER, gh.fake);

    expect(gh.comments).toHaveLength(1);
    expect(gh.comments[0]?.body).toContain("v3");
  });

  it("finds its comment beyond the first page", async () => {
    const others = Array.from({ length: 150 }, (_, i) => ({ id: i + 1, body: "chatter" }));
    const gh = github([...others, { id: 999, body: `${REPORT_MARKER}\nold` }]);

    expect(await upsertComment(ctx, `${REPORT_MARKER}\nnew`, REPORT_MARKER, gh.fake)).toBe(
      "updated",
    );
    expect(gh.calls.filter((c) => c.method === "GET")).toHaveLength(2);
  });

  it("explains a 403 from a fork's read-only token", async () => {
    await expect(upsertComment(ctx, "x", REPORT_MARKER, github([], 403).fake)).rejects.toThrow(
      /forks get a read-only token/,
    );
  });
});

describe("commentStep", () => {
  async function workspace(report: string | null, errorLog: string | null) {
    const dir = await mkdtemp(path.join(tmpdir(), "contextforge-action-"));
    const event = path.join(dir, "event.json");
    await writeFile(event, JSON.stringify({ pull_request: { number: 7 } }));
    if (report !== null) await writeFile(path.join(dir, "report.md"), report);
    if (errorLog !== null) await writeFile(path.join(dir, "error.log"), errorLog);
    return {
      reportPath: path.join(dir, "report.md"),
      errorLogPath: path.join(dir, "error.log"),
      env: {
        GITHUB_EVENT_PATH: event,
        GITHUB_TOKEN: "t",
        GITHUB_REPOSITORY: "o/r",
        GITHUB_API_URL: "https://api.github.test",
      },
    };
  }

  it("posts the report", async () => {
    const gh = github();
    const ws = await workspace(`${REPORT_MARKER}\n## ✅ report`, null);

    await commentStep({ ...ws, fetch: gh.fake, log: () => undefined });

    expect(gh.comments[0]?.body).toContain("✅ report");
  });

  it("posts the tool error when there is no report, so a broken check is never silent", async () => {
    const gh = github();
    const ws = await workspace(
      null,
      "INFO building\n[APP_FAILED] The app did not become healthy within 120s",
    );

    await commentStep({ ...ws, fetch: gh.fake, log: () => undefined });

    expect(gh.comments[0]?.body).toContain("could not reach a verdict");
    expect(gh.comments[0]?.body).toContain("APP_FAILED");
  });

  it("warns but still exits 0 when the comment cannot be posted", async () => {
    const lines: string[] = [];
    const ws = await workspace("report", null);

    const code = await commentStep({
      ...ws,
      fetch: github([], 403).fake,
      log: (l) => lines.push(l),
    });

    expect(code).toBe(0);
    expect(lines.join("\n")).toContain("::warning::");
  });

  it("does nothing outside a pull request", async () => {
    const gh = github();
    const ws = await workspace("report", null);
    await writeFile(ws.env.GITHUB_EVENT_PATH, JSON.stringify({ ref: "refs/heads/main" }));

    await commentStep({ ...ws, fetch: gh.fake, log: () => undefined });

    expect(gh.calls).toEqual([]);
  });

  it("builds a body even when nothing at all was written", async () => {
    expect(await commentBody("/nope/report.md", "/nope/error.log")).toContain(
      "without writing a report",
    );
  });
});
