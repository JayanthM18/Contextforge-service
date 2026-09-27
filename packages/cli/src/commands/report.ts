/** `contextforge report <results.json> --format md|html|json [--output <file>]` */

import { writeFile } from "node:fs/promises";

import type { ResultsFile } from "@contextforge/shared";

import { readResultsFile } from "../compare/results.js";
import { renderHtml } from "../report/html.js";
import { renderMarkdown } from "../report/markdown.js";

export type ReportFormat = "md" | "html" | "json";

export function render(results: ResultsFile, format: ReportFormat): string {
  if (format === "md") return renderMarkdown(results);
  if (format === "html") return renderHtml(results);
  return `${JSON.stringify(results, null, 2)}\n`;
}

export async function reportCommand(options: {
  readonly resultsPath: string;
  readonly format: ReportFormat;
  readonly outputPath?: string;
  readonly stdout?: (text: string) => void;
}): Promise<void> {
  const text = render(await readResultsFile(options.resultsPath), options.format);
  if (options.outputPath === undefined) {
    (options.stdout ?? ((t: string) => process.stdout.write(t)))(text);
  } else {
    await writeFile(options.outputPath, text);
  }
}
