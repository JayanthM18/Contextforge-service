import { describe, expect, it } from "vitest";

import { applyScores, APP_DID_NOT_ANSWER } from "../src/evaluator/aggregate.js";
import { pairCases, pairedMeans, regressedCases } from "../src/compare/diff.js";
import { summarise } from "../src/compare/summary.js";
import { evaluateMetric } from "../src/compare/thresholds.js";
import { compare } from "../src/compare/verdict.js";
import { ContextForgeError } from "../src/util/errors.js";
import { testConfig } from "./helpers.js";
import { all, METRICS, record, result } from "./fixtures.js";

const config = testConfig();
const cases = (value: number, n = 10) =>
  Array.from({ length: n }, (_, i) => record(`tc-${String(i)}`, all(value)));

describe("pairedMeans", () => {
  it("averages only cases scored on both sides", () => {
    const baseline = result([
      record("a", { faithfulness: 0.9 }),
      record("b", { faithfulness: 0.5 }),
    ]);
    const candidate = result([
      record("a", { faithfulness: 0.8 }),
      record("b", { faithfulness: null }),
    ]);

    expect(pairedMeans(pairCases(baseline, candidate), "faithfulness")).toEqual({
      baseline: 0.9,
      candidate: 0.8,
      count: 1,
    });
  });

  it("is null when nothing was scored on both sides", () => {
    const pairs = pairCases(
      result([record("a", { faithfulness: null })]),
      result([record("a", { faithfulness: 0.9 })]),
    );

    expect(pairedMeans(pairs, "faithfulness")).toBeNull();
  });
});

describe("evaluateMetric", () => {
  const paired = (baseline: number, candidate: number) => ({ baseline, candidate, count: 10 });

  it("passes a drop within mean_drop", () => {
    expect(evaluateMetric("faithfulness", paired(0.8, 0.76), 0.76, { meanDrop: 0.05 }).status).toBe(
      "pass",
    );
  });

  it("passes a drop of exactly mean_drop", () => {
    expect(evaluateMetric("faithfulness", paired(0.8, 0.75), 0.75, { meanDrop: 0.05 }).status).toBe(
      "pass",
    );
  });

  it("fails a drop beyond mean_drop and says by how much", () => {
    const verdict = evaluateMetric("context_recall", paired(0.78, 0.66), 0.66, { meanDrop: 0.05 });

    expect(verdict).toMatchObject({ status: "fail", threshold: -0.05 });
    expect(verdict.delta).toBeCloseTo(-0.12, 10);
    expect(verdict.reasons[0]).toContain("fell by 0.120");
  });

  it("fails below the absolute floor even when nothing dropped", () => {
    const verdict = evaluateMetric("faithfulness", paired(0.6, 0.6), 0.6, {
      meanDrop: 0.05,
      floor: 0.7,
    });

    expect(verdict.status).toBe("fail");
    expect(verdict.reasons[0]).toContain("below the floor");
  });

  it("fails a gated metric that could not be measured, rather than passing silently", () => {
    expect(evaluateMetric("faithfulness", null, null, { meanDrop: 0.05 }).status).toBe("fail");
  });

  it("skips an ungated metric that could not be measured", () => {
    expect(evaluateMetric("faithfulness", null, null, {}).status).toBe("skipped");
  });

  it("reports an ungated metric without judging it", () => {
    expect(evaluateMetric("faithfulness", paired(0.9, 0.1), 0.1, {}).status).toBe("pass");
  });
});

describe("regressedCases", () => {
  it("flags a case whose score fell by more than case_drop", () => {
    const pairs = pairCases(
      result([record("a", { faithfulness: 0.9 })]),
      result([record("a", { faithfulness: 0.5 })]),
    );

    expect(regressedCases(pairs, METRICS, 0.3)).toEqual([
      { caseId: "a", reasons: ["faithfulness fell from 0.90 to 0.50"] },
    ]);
  });

  it("ignores a fall within case_drop", () => {
    const pairs = pairCases(
      result([record("a", { faithfulness: 0.9 })]),
      result([record("a", { faithfulness: 0.65 })]),
    );

    expect(regressedCases(pairs, METRICS, 0.3)).toEqual([]);
  });

  it("flags a case the candidate app stopped answering", () => {
    const pairs = pairCases(
      result([record("a", all(0.9))]),
      result([record("a", all(null), { status: "failed", error: "HTTP 500" })]),
    );

    expect(regressedCases(pairs, METRICS, 0.3)[0]?.reasons[0]).toContain("HTTP 500");
  });

  it("does not treat a score the judge could not produce as a regression", () => {
    const pairs = pairCases(
      result([record("a", { faithfulness: 0.9 })]),
      result([record("a", { faithfulness: null })]),
    );

    expect(regressedCases(pairs, METRICS, 0.3)).toEqual([]);
  });
});

describe("compare", () => {
  it("passes identical results", () => {
    const verdict = compare(result(cases(0.8)), result(cases(0.8)), config, "dual");

    expect(verdict.status).toBe("pass");
    expect(verdict.regressed_cases).toEqual([]);
  });

  it("fails a mean drop and names the metric", () => {
    const verdict = compare(result(cases(0.8)), result(cases(0.7)), config, "cached");

    expect(verdict.status).toBe("fail");
    expect(verdict.mode).toBe("cached");
    expect(verdict.metrics.filter((m) => m.status === "fail").map((m) => m.name)).toEqual(METRICS);
  });

  /**
   * `collapsed` cases fall 0.6 → 0.1 on context_recall (a drop of 0.5, past
   * case_drop) while the rest rise 0.6 → 0.9, so the mean holds or improves.
   */
  function hiddenCollapse(collapsed: number) {
    const base = Array.from({ length: 10 }, (_, i) =>
      record(`tc-${String(i)}`, { ...all(0.8), context_recall: 0.6 }),
    );
    const cand = Array.from({ length: 10 }, (_, i) =>
      record(`tc-${String(i)}`, { ...all(0.8), context_recall: i < collapsed ? 0.1 : 0.9 }),
    );
    return compare(result(base), result(cand), config, "dual");
  }

  it("fails on too many regressed cases even when every mean holds", () => {
    const verdict = hiddenCollapse(4);

    expect(verdict.metrics.every((m) => m.status === "pass")).toBe(true);
    expect(verdict.regressed_cases).toHaveLength(4);
    expect(verdict.status).toBe("fail");
    expect(verdict.notes[0]).toContain("more than the limit of 3");
  });

  it("allows exactly max_regressed_cases", () => {
    const verdict = hiddenCollapse(3);

    expect(verdict.regressed_cases).toHaveLength(3);
    expect(verdict.status).toBe("pass");
  });

  it("notes failed answers, unscored metrics and one-sided cases", () => {
    const base = [record("a", all(0.8)), record("b", all(0.8)), record("only-base", all(0.8))];
    const cand = [
      record("a", all(0.8)),
      record("b", all(null), { status: "failed", error: "timeout" }),
    ];

    const notes = compare(result(base), result(cand), config, "dual").notes.join("\n");

    expect(notes).toContain("the candidate app failed to answer 1 cases");
    expect(notes).toContain("1 cases appear on only one side");
  });

  it("refuses results from different test sets", () => {
    expect(() =>
      compare(
        result(cases(0.8)),
        result(cases(0.8), { fingerprint: { dataset_hash: "sha256:other" } }),
        config,
        "dual",
      ),
    ).toThrow(ContextForgeError);
  });

  it("refuses results from different judges", () => {
    expect(() =>
      compare(
        result(cases(0.8)),
        result(cases(0.8), {
          fingerprint: {
            judge: { model: "qwen3:14b", temperature: 0, seed: 42, reasoning_effort: null },
          },
        }),
        config,
        "dual",
      ),
    ).toThrow(/different judges/);
  });

  it("refuses results with different embedding models", () => {
    expect(() =>
      compare(
        result(cases(0.8)),
        result(cases(0.8), { fingerprint: { embeddings: { model: "nomic-embed-text" } } }),
        config,
        "dual",
      ),
    ).toThrow(/different judges/);
  });
});

describe("summarise", () => {
  it("means each metric over the cases that scored it", () => {
    expect(
      summarise(
        [record("a", { faithfulness: 0.8 }), record("b", { faithfulness: null })],
        ["faithfulness"],
      ),
    ).toEqual({
      faithfulness: 0.8,
    });
  });

  it("is null for a metric nothing scored", () => {
    expect(summarise([record("a", { faithfulness: null })], ["faithfulness"])).toEqual({
      faithfulness: null,
    });
  });
});

describe("applyScores", () => {
  const response = (id: string, value: number | null, error?: string) => ({
    evaluator: { ragas_version: "0.4.3", judge_model: "m", embeddings_model: null },
    results: [
      {
        case_id: id,
        scores: { faithfulness: value },
        errors: error === undefined ? {} : { faithfulness: error },
      },
    ],
  });
  const base = record("a", {});

  it("keeps a single pass's score with no spread", () => {
    expect(applyScores([base], [response("a", 0.8)], ["faithfulness"])[0]).toMatchObject({
      scores: { faithfulness: 0.8 },
      scores_stddev: { faithfulness: null },
    });
  });

  it("stores the mean and spread over several passes", () => {
    const [scored] = applyScores(
      [base],
      [response("a", 0.8), response("a", 0.6)],
      ["faithfulness"],
    );

    expect(scored?.scores.faithfulness).toBeCloseTo(0.7, 10);
    expect(scored?.scores_stddev.faithfulness).toBeCloseTo(0.1, 10);
  });

  it("notes a metric scored in only some passes", () => {
    const [scored] = applyScores(
      [base],
      [response("a", 0.8), response("a", null, "NaN")],
      ["faithfulness"],
    );

    expect(scored?.scores.faithfulness).toBe(0.8);
    expect(scored?.score_errors.faithfulness).toBe("scored in 1 of 2 runs");
  });

  it("keeps the judge's reason when no pass produced a score", () => {
    const [scored] = applyScores([base], [response("a", null, "no statements")], ["faithfulness"]);

    expect(scored?.score_errors.faithfulness).toBe("no statements");
  });

  it("marks cases the app did not answer as unscorable", () => {
    const failed = record("a", {}, { status: "failed", error: "HTTP 500" });

    expect(applyScores([failed], [], ["faithfulness"])[0]?.score_errors.faithfulness).toBe(
      APP_DID_NOT_ANSWER,
    );
  });
});
