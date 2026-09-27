/**
 * The standalone HTML report, uploaded as a CI artifact. Every case, not just
 * the regressed ones, with both sides' answers and scores. Pure.
 */

import type { CaseRecord, Metric, ResultsFile } from "@contextforge/shared";

import { TOOL_VERSION } from "../util/version.js";
import { contextIds, headline, modeLabel, score, signed } from "./format.js";

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const STYLE = `
:root { --bg:#fbfbf9; --fg:#1d1d1b; --muted:#6b6b66; --line:#e3e2dc; --bad:#b42318; --bad-bg:#fdecea; --good:#067647; }
@media (prefers-color-scheme: dark) {
  :root { --bg:#161615; --fg:#ecebe6; --muted:#a3a29c; --line:#34332f; --bad:#f97066; --bad-bg:#3a1714; --good:#47cd89; }
}
* { box-sizing: border-box; }
body { margin: 0; padding: 2rem clamp(1rem, 4vw, 3rem); background: var(--bg); color: var(--fg);
       font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
h1 { font-size: 1.5rem; margin: 0 0 .25rem; }
.meta, .muted { color: var(--muted); font-size: .875rem; }
.scroll { overflow-x: auto; margin: 1.25rem 0; }
table { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; }
th, td { border-bottom: 1px solid var(--line); padding: .45rem .6rem; text-align: left; vertical-align: top; }
th { font-weight: 600; font-size: .8rem; text-transform: uppercase; letter-spacing: .03em; color: var(--muted); }
td.num { text-align: right; white-space: nowrap; }
.fail { color: var(--bad); font-weight: 600; }
.pass { color: var(--good); }
tr.regressed { background: var(--bad-bg); }
details { margin: .25rem 0; }
summary { cursor: pointer; }
.answer { white-space: pre-wrap; margin: .25rem 0 .5rem; }
ul { padding-left: 1.2rem; }
`;

function caseRow(
  id: string,
  base: CaseRecord | undefined,
  cand: CaseRecord | undefined,
  metrics: readonly Metric[],
  reasons: readonly string[] | undefined,
): string {
  const cells = metrics
    .map((m) => {
      const b = base?.scores[m];
      const c = cand?.scores[m];
      const worse = typeof b === "number" && typeof c === "number" && c < b;
      return `<td class="num${worse ? " fail" : ""}">${score(b)} → ${score(c)}</td>`;
    })
    .join("");
  const detail = `<details><summary>${escapeHtml(cand?.question ?? base?.question ?? id)}</summary>
    ${reasons === undefined ? "" : `<ul>${reasons.map((r) => `<li class="fail">${escapeHtml(r)}</li>`).join("")}</ul>`}
    <div class="muted">Baseline answer · contexts: ${escapeHtml(contextIds(base))}</div>
    <div class="answer">${escapeHtml(base?.answer ?? base?.error ?? "(no answer)")}</div>
    <div class="muted">Candidate answer · contexts: ${escapeHtml(contextIds(cand))}</div>
    <div class="answer">${escapeHtml(cand?.answer ?? cand?.error ?? "(no answer)")}</div>
  </details>`;
  return `<tr${reasons === undefined ? "" : ' class="regressed"'}><td><code>${escapeHtml(id)}</code></td><td>${detail}</td>${cells}</tr>`;
}

export function renderHtml(results: ResultsFile): string {
  const { verdict, baseline, candidate } = results;
  const metrics = verdict.metrics.map((m) => m.name);
  const baseById = new Map(baseline.results.map((r) => [r.case_id, r]));
  const reasonsById = new Map(verdict.regressions.map((r) => [r.case_id, r.reasons]));

  const metricRows = verdict.metrics
    .map(
      (
        m,
      ) => `<tr><td>${m.name}</td><td class="num">${score(m.baseline)}</td><td class="num">${score(m.candidate)}</td>
        <td class="num${m.status === "fail" ? " fail" : ""}">${signed(m.delta)}</td>
        <td class="num">${m.threshold === null ? "—" : score(-m.threshold)}</td><td class="num">${score(m.floor)}</td>
        <td class="${m.status === "fail" ? "fail" : "pass"}">${m.status}${m.reasons.length > 0 ? ` — ${escapeHtml(m.reasons.join("; "))}` : ""}</td></tr>`,
    )
    .join("");

  // Regressed cases first, then the rest in test-set order.
  const ids = [
    ...verdict.regressed_cases,
    ...candidate.results.map((r) => r.case_id).filter((id) => !reasonsById.has(id)),
  ];
  const candById = new Map(candidate.results.map((r) => [r.case_id, r]));
  const caseRows = ids
    .map((id) => caseRow(id, baseById.get(id), candById.get(id), metrics, reasonsById.get(id)))
    .join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>ContextForge report</title><style>${STYLE}</style></head>
<body>
<h1>${escapeHtml(headline(results))}</h1>
<p class="meta">Baseline <code>${escapeHtml(verdict.baseline_commit.slice(0, 12))}</code> · candidate <code>${escapeHtml(verdict.candidate_commit.slice(0, 12))}</code> ·
${escapeHtml(modeLabel(verdict.mode))} · judge ${escapeHtml(verdict.judge_model)} · ContextForge ${TOOL_VERSION}</p>
<div class="scroll"><table><thead><tr><th>Metric</th><th>Baseline</th><th>Candidate</th><th>Δ</th><th>Allowed drop</th><th>Floor</th><th>Status</th></tr></thead>
<tbody>${metricRows}</tbody></table></div>
${verdict.notes.length > 0 ? `<ul class="muted">${verdict.notes.map((n) => `<li>${escapeHtml(n)}</li>`).join("")}</ul>` : ""}
<h2>Cases</h2>
<div class="scroll"><table><thead><tr><th>Case</th><th>Question and answers</th>${metrics.map((m) => `<th>${m}</th>`).join("")}</tr></thead>
<tbody>${caseRows}</tbody></table></div>
</body></html>
`;
}
