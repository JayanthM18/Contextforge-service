/** Formatting shared by the Markdown and HTML reports. Pure. */

import type { CaseRecord, ResultsFile } from "@contextforge/shared";

export const REPORT_MARKER = "<!-- contextforge-report -->";

export function score(value: number | null | undefined): string {
  return typeof value === "number" ? value.toFixed(3) : "—";
}

export function signed(value: number | null): string {
  if (value === null) return "—";
  const text = Math.abs(value).toFixed(3);
  return value < 0 ? `−${text}` : `+${text}`;
}

export function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

export function contextIds(record: CaseRecord | undefined): string {
  if (record === undefined) return "—";
  const ids = record.contexts.map((c) => c.id ?? "(no id)");
  return ids.length === 0 ? "(none)" : ids.join(", ");
}

export function headline(results: ResultsFile): string {
  const { verdict } = results;
  const count = verdict.regressed_cases.length;
  const cases = `${String(count)} regressed ${count === 1 ? "case" : "cases"}`;
  return verdict.status === "pass"
    ? `✅ ContextForge: no regression (${cases})`
    : `❌ ContextForge: regression detected (${cases})`;
}

export function modeLabel(mode: ResultsFile["verdict"]["mode"]): string {
  return {
    cached: "cached — stored baseline scores reused",
    dual: "rebuilt — merge-base baseline built and scored",
  }[mode];
}
