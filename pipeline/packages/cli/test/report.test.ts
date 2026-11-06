import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { ResultsFile } from "@contextforge/shared";
import { describe, expect, it } from "vitest";

import { render, reportCommand } from "../src/commands/report.js";
import { compare } from "../src/compare/verdict.js";
import { REPORT_MARKER } from "../src/report/format.js";
import { escapeHtml, renderHtml } from "../src/report/html.js";
import { escapeMarkdown, renderMarkdown, renderToolError } from "../src/report/markdown.js";
import { testConfig } from "./helpers.js";
import { all, record, result } from "./fixtures.js";

function resultsFor(
  baseValue: number,
  candValue: number,
  candAnswer = "candidate answer",
): ResultsFile {
  const baseline = result([record("tc-001", all(baseValue)), record("tc-002", all(baseValue))]);
  const candidate = result([
    record("tc-001", all(candValue), { answer: candAnswer }),
    record("tc-002", all(candValue)),
  ]);
  return { verdict: compare(baseline, candidate, testConfig(), "cached"), baseline, candidate };
}

describe("renderMarkdown", () => {
  it("starts with the sticky marker, so the comment can be found and edited", () => {
    expect(renderMarkdown(resultsFor(0.8, 0.8)).startsWith(REPORT_MARKER)).toBe(true);
  });

  it("headlines a pass", () => {
    expect(renderMarkdown(resultsFor(0.8, 0.8))).toContain(
      "✅ ContextForge: no regression (0 regressed cases)",
    );
  });

  it("headlines a failure with the regressed-case count", () => {
    expect(renderMarkdown(resultsFor(0.9, 0.4))).toContain(
      "❌ ContextForge: regression detected (2 regressed cases)",
    );
  });

  it("tabulates every metric with baseline, candidate, delta, threshold and status", () => {
    const md = renderMarkdown(resultsFor(0.9, 0.4));

    expect(md).toContain("| faithfulness | 0.900 | 0.400 | **−0.500** | 0.050 | 0.700 | ❌ |");
    expect(md).toContain("> **faithfulness:**");
  });

  it("lists regressed cases with both answers and context ids in a collapsed section", () => {
    const md = renderMarkdown(resultsFor(0.9, 0.4));

    expect(md).toContain("<details><summary>2 regressed cases</summary>");
    expect(renderMarkdown(resultsFor(0.8, 0.8))).not.toContain("<details>");
    expect(md).toContain("`tc-001`");
    expect(md).toContain("| Context ids | tc-001.md#c1 | tc-001.md#c1 |");
    expect(md).toContain("faithfulness fell from 0.90 to 0.40");
  });

  it("names the baseline, the mode and the judge in the footnote", () => {
    expect(renderMarkdown(resultsFor(0.8, 0.8))).toMatch(
      /Baseline `abc1234`.*mode: cached.*judge: gpt-4o-mini/,
    );
  });

  it("escapes app output that would break the table or render as HTML", () => {
    const md = renderMarkdown(resultsFor(0.9, 0.4, "a | b <script>alert(1)</script>\nnext line"));

    expect(md).toContain("a \\| b &lt;script&gt;alert(1)&lt;/script&gt; next line");
    expect(md).not.toContain("<script>");
  });

  it("stays under GitHub's comment size limit", () => {
    const huge = "x".repeat(5000);
    const records = (value: number) =>
      Array.from({ length: 200 }, (_, i) =>
        record(`tc-${String(i)}`, all(value), { answer: huge }),
      );
    const baseline = result(records(0.9));
    const candidate = result(records(0.1));
    const md = renderMarkdown({
      verdict: compare(baseline, candidate, testConfig(), "dual"),
      baseline,
      candidate,
    });

    expect(md.length).toBeLessThan(65_536);
    expect(md).toContain("more; see the HTML report artifact");
  });
});

describe("renderToolError", () => {
  it("says the check broke, which is not a regression", () => {
    const body = renderToolError("[DOCKER_UNAVAILABLE] The Docker daemon is not reachable");

    expect(body.startsWith(REPORT_MARKER)).toBe(true);
    expect(body).toContain("not a quality regression");
    expect(body).toContain("DOCKER_UNAVAILABLE");
  });

  it("cannot be broken out of its code block", () => {
    expect(renderToolError("```\n## injected")).not.toContain("```\n## injected");
  });
});

describe("renderHtml", () => {
  it("is a complete page with every case, regressed ones first", () => {
    const html = renderHtml(resultsFor(0.9, 0.4));

    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html.indexOf("tc-001")).toBeLessThan(html.indexOf("tc-002"));
    expect(html).toContain('class="regressed"');
  });

  it("escapes app output", () => {
    const html = renderHtml(resultsFor(0.9, 0.4, '<img src=x onerror="alert(1)">'));

    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });
});

describe("escaping helpers", () => {
  it("escapes markdown table breakers", () => {
    expect(escapeMarkdown("a|b\n<c>&")).toBe("a\\|b &lt;c&gt;&amp;");
  });

  it("escapes HTML attribute breakers", () => {
    expect(escapeHtml(`"'<>&`)).toBe("&quot;&#39;&lt;&gt;&amp;");
  });
});

describe("report command", () => {
  it("renders a results file in each format", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "contextforge-report-"));
    const file = path.join(dir, "results.json");
    const results = resultsFor(0.8, 0.8);
    await writeFile(file, JSON.stringify(results));

    let out = "";
    await reportCommand({
      resultsPath: file,
      format: "md",
      stdout: (t) => {
        out = t;
      },
    });

    expect(out).toBe(render(results, "md"));
    expect(JSON.parse(render(results, "json"))).toEqual(results);
  });
});
