/**
 * The sticky pull-request comment (docs/DESIGN.md section 5). Pure.
 *
 * Everything the app produced is escaped: an answer containing a pipe would
 * break the table, and one containing HTML would render in the comment.
 */

import type { ResultsFile } from "@contextforge/shared";

import { TOOL_VERSION } from "../util/version.js";
import {
  contextIds,
  headline,
  modeLabel,
  REPORT_MARKER,
  score,
  signed,
  truncate,
} from "./format.js";

/** GitHub rejects comments over 65,536 characters; stay well clear of it. */
const MAX_LENGTH = 60_000;
const MAX_CASES_SHOWN = 25;

export function escapeMarkdown(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\|/g, "\\|")
    .replace(/[\r\n]+/g, " ");
}

function cell(text: string, max = 280): string {
  return escapeMarkdown(truncate(text, max));
}

export function renderMarkdown(results: ResultsFile): string {
  const { verdict, baseline, candidate } = results;
  const lines: string[] = [REPORT_MARKER, `## ${headline(results)}`, ""];

  lines.push("| Metric | Baseline | Candidate | Δ | Allowed drop | Floor | |");
  lines.push("|---|---:|---:|---:|---:|---:|:-:|");
  for (const m of verdict.metrics) {
    const icon = m.status === "pass" ? "✅" : m.status === "fail" ? "❌" : "➖";
    const delta =
      m.status === "fail" && m.delta !== null ? `**${signed(m.delta)}**` : signed(m.delta);
    lines.push(
      `| ${m.name} | ${score(m.baseline)} | ${score(m.candidate)} | ${delta} | ` +
        `${m.threshold === null ? "—" : score(-m.threshold)} | ${score(m.floor)} | ${icon} |`,
    );
  }

  const failing = verdict.metrics.filter((m) => m.status === "fail");
  if (failing.length > 0) {
    lines.push("");
    for (const m of failing) lines.push(`> **${m.name}:** ${escapeMarkdown(m.reasons.join("; "))}`);
  }

  if (verdict.regressions.length > 0) {
    const baseById = new Map(baseline.results.map((r) => [r.case_id, r]));
    const candById = new Map(candidate.results.map((r) => [r.case_id, r]));
    const shown = verdict.regressions.slice(0, MAX_CASES_SHOWN);

    lines.push(
      "",
      `<details><summary>${String(verdict.regressions.length)} regressed ${verdict.regressions.length === 1 ? "case" : "cases"}</summary>`,
      "",
    );
    for (const regression of shown) {
      const base = baseById.get(regression.case_id);
      const cand = candById.get(regression.case_id);
      lines.push(
        `#### \`${escapeMarkdown(regression.case_id)}\` ${cell(cand?.question ?? base?.question ?? "", 200)}`,
      );
      for (const reason of regression.reasons) lines.push(`- ${escapeMarkdown(reason)}`);
      lines.push("", "| | Baseline | Candidate |", "|---|---|---|");
      lines.push(
        `| Answer | ${cell(base?.answer ?? "(no answer)")} | ${cell(cand?.answer ?? cand?.error ?? "(no answer)")} |`,
      );
      lines.push(`| Context ids | ${cell(contextIds(base))} | ${cell(contextIds(cand))} |`, "");
    }
    if (verdict.regressions.length > shown.length) {
      lines.push(
        `…and ${String(verdict.regressions.length - shown.length)} more; see the HTML report artifact.`,
        "",
      );
    }
    lines.push("</details>");
  }

  if (verdict.notes.length > 0) {
    lines.push("", "**Notes**");
    for (const note of verdict.notes) lines.push(`- ${escapeMarkdown(note)}`);
  }

  lines.push(
    "",
    `<sub>Baseline \`${verdict.baseline_commit.slice(0, 7)}\` · candidate \`${verdict.candidate_commit.slice(0, 7)}\` · ` +
      `mode: ${modeLabel(verdict.mode)} · judge: ${escapeMarkdown(verdict.judge_model)} · ContextForge ${TOOL_VERSION}</sub>`,
  );

  const text = `${lines.join("\n")}\n`;
  return text.length <= MAX_LENGTH
    ? text
    : `${text.slice(0, MAX_LENGTH)}\n\n…report truncated; see the HTML report artifact.\n`;
}

/** The comment posted when the tool broke before reaching a verdict. */
export function renderToolError(message: string): string {
  return [
    REPORT_MARKER,
    "## ⚠️ ContextForge could not reach a verdict",
    "",
    "This is a failure of the check itself, not a quality regression.",
    "",
    "```",
    truncate(message, 3000).replace(/```/g, "'''"),
    "```",
    "",
  ].join("\n");
}
