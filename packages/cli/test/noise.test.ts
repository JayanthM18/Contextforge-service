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

const quiet = (cases: number): ResultsFile => selfRun(Array.from({ length: cases }, () => 0));

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

  it("never suggests a mean threshold one flipped case could breach on its own", () => {
    // The real measurement: 34 cases, five self-comparisons, zero drift. A
    // drift-only rule suggested 0.02, below one flip (1/34 = 0.029).
    expect(measureNoise([quiet(34)], ["faithfulness"]).suggested.mean_drop.faithfulness).toBe(0.05);
  });

  it("follows the drift when it is larger than one flip", () => {
    const drifting = selfRun(Array.from({ length: 200 }, () => 0.05));

    expect(measureNoise([drifting], ["faithfulness"]).suggested.mean_drop.faithfulness).toBe(0.08);
  });

  it("never suggests a case threshold below 0.30, one statement's worth", () => {
    expect(measureNoise([quiet(34)], ["faithfulness"]).suggested.case_drop).toBe(0.3);
  });

  it("raises the case threshold above the 95th-percentile case drop when that is larger", () => {
    const swinging = selfRun(Array.from({ length: 20 }, () => 0.5));

    expect(measureNoise([swinging], ["faithfulness"]).suggested.case_drop).toBe(0.6);
  });

  it("records the runs, the cases and the judge, which the measurement belongs to", () => {
    expect(report).toMatchObject({ runs: 2, cases: 4, judge: "gpt-4o-mini" });
  });
});
