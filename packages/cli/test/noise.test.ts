import type { ResultsFile } from "@contextforge/shared";
import { describe, expect, it } from "vitest";

import { measureNoise } from "../src/compare/noise.js";
import { compare } from "../src/compare/verdict.js";
import { testConfig } from "./helpers.js";
import { record, result } from "./fixtures.js";

/** main-vs-main run where each case's faithfulness wobbles by the given amounts. */
function selfRun(wobble: number[]): ResultsFile {
  const baseline = result(wobble.map((_, i) => record(`tc-${String(i)}`, { faithfulness: 0.8 })));
  const candidate = result(
    wobble.map((w, i) => record(`tc-${String(i)}`, { faithfulness: 0.8 - w })),
  );
  return { verdict: compare(baseline, candidate, testConfig(), "dual"), baseline, candidate };
}

describe("measureNoise", () => {
  const report = measureNoise(
    [selfRun([0.0, 0.1, 0.0, 0.0]), selfRun([0.04, 0.0, 0.0, 0.0])],
    ["faithfulness"],
  );
  const faithfulness = report.metrics[0];

  it("measures how far the mean moved when nothing changed", () => {
    expect(faithfulness?.maxAbsDelta).toBeCloseTo(0.025, 10);
    expect(faithfulness?.meanAbsDelta).toBeCloseTo(0.0175, 10);
  });

  it("measures the spread of single-case drops", () => {
    expect(faithfulness?.caseDropMax).toBeCloseTo(0.1, 10);
  });

  it("suggests a mean threshold above the drift seen, never below 0.02", () => {
    expect(report.suggested.mean_drop.faithfulness).toBe(0.04);
    expect(measureNoise([selfRun([0, 0])], ["faithfulness"]).suggested.mean_drop.faithfulness).toBe(
      0.02,
    );
  });

  it("suggests a case threshold above the 95th-percentile case drop", () => {
    expect(report.suggested.case_drop).toBeGreaterThanOrEqual(0.05);
    expect(report.suggested.case_drop).toBeLessThanOrEqual(1);
  });

  it("records the run count and the judge, which the measurement belongs to", () => {
    expect(report).toMatchObject({ runs: 2, judge: "gpt-4o-mini" });
  });
});
