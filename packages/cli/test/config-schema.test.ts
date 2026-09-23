/**
 * Schema validation. The gate for this stage is that every error names the key
 * at fault, so each invalid case asserts on the path as well as the message.
 */

import { describe, expect, it } from "vitest";

import { describeIssue } from "../src/config/load.js";
import { configSchema, METRICS } from "../src/config/schema.js";

type Section = Record<string, unknown>;

interface Overrides {
  version?: unknown;
  app?: Section;
  dataset?: Section;
  evaluation?: Section;
  baseline?: Section;
  thresholds?: Section;
  report?: Section;
}

const BASE = {
  version: 1 as unknown,
  app: { compose_file: "docker-compose.eval.yml", service: "rag-app" } as Section,
  dataset: { path: "benchmark/testcases.json" } as Section,
  evaluation: {
    metrics: ["context_precision", "faithfulness"],
    judge: { provider: "openai", model: "gpt-4o-mini" },
  } as Section,
  baseline: {} as Section,
  thresholds: { mean_drop: { faithfulness: 0.05 } } as Section,
  report: {} as Section,
};

/** The base config with one or more sections merged over it. */
function config(overrides: Overrides = {}): unknown {
  return {
    version: overrides.version ?? BASE.version,
    app: { ...BASE.app, ...overrides.app },
    dataset: { ...BASE.dataset, ...overrides.dataset },
    evaluation: { ...BASE.evaluation, ...overrides.evaluation },
    baseline: { ...BASE.baseline, ...overrides.baseline },
    thresholds: overrides.thresholds ?? BASE.thresholds,
    report: { ...BASE.report, ...overrides.report },
  };
}

/** Every rendered "key: message" line, so tests can assert on paths. */
function problems(value: unknown): string[] {
  const result = configSchema.safeParse(value);
  return result.success ? [] : result.error.issues.flatMap(describeIssue);
}

describe("a valid config", () => {
  it("parses", () => {
    expect(problems(config())).toEqual([]);
  });

  it("fills in every documented default", () => {
    const parsed = configSchema.parse(config());

    expect(parsed.app.port).toBe(8000);
    expect(parsed.app.health_path).toBe("/health");
    expect(parsed.app.query_path).toBe("/query");
    expect(parsed.app.startup_timeout).toBe(120);
    expect(parsed.dataset.size).toBe(40);
    expect(parsed.evaluation.runs).toBe(1);
    expect(parsed.evaluation.concurrency).toBe(4);
    expect(parsed.evaluation.judge.temperature).toBe(0);
    expect(parsed.evaluation.judge.seed).toBe(42);
    expect(parsed.evaluation.judge.base_url).toBeNull();
    expect(parsed.evaluation.judge.api_key_env).toBeNull();
    expect(parsed.baseline.mode).toBe("cached");
    expect(parsed.baseline.store).toBe("benchmark/baseline");
    expect(parsed.baseline.rebuild_if_missing).toBe(true);
    expect(parsed.thresholds.max_regressed_cases).toBe(3);
    expect(parsed.report.pr_comment).toBe(true);
  });
});

describe("invalid configs", () => {
  it("1. rejects an unknown key, naming the key and not its parent", () => {
    expect(problems(config({ evaluation: { judge_model: "gpt-4o" } }))).toContain(
      "evaluation.judge_model: unrecognized key",
    );
  });

  it("2. rejects a wrong version, naming version", () => {
    expect(problems(config({ version: 2 }))[0]).toMatch(/^version: must be 1/);
  });

  it("3. rejects an unknown metric, naming its position in the list", () => {
    const lines = problems(config({ evaluation: { metrics: ["bleu"] }, thresholds: {} }));

    expect(lines.some((line) => line.startsWith("evaluation.metrics.0:"))).toBe(true);
    expect(lines[0]).toContain(METRICS[0]);
  });

  it("4. rejects a threshold for a metric that is not being measured", () => {
    expect(problems(config({ thresholds: { mean_drop: { context_recall: 0.05 } } }))).toContain(
      'thresholds.mean_drop.context_recall: "context_recall" is not in evaluation.metrics, ' +
        "so it is never measured",
    );
  });

  it("5. rejects a threshold naming something that is not a metric at all", () => {
    expect(problems(config({ thresholds: { absolute_floor: { accuracy: 0.9 } } }))[0]).toMatch(
      /^thresholds\.absolute_floor\.accuracy: "accuracy" is not a known metric/,
    );
  });

  it("6. rejects a startup_timeout outside the documented range", () => {
    expect(problems(config({ app: { startup_timeout: 5 } }))).toContain(
      "app.startup_timeout: must be between 10 and 900 seconds",
    );
    expect(problems(config({ app: { startup_timeout: 1000 } }))).toContain(
      "app.startup_timeout: must be between 10 and 900 seconds",
    );
  });

  it("7. requires embeddings when answer_relevancy is measured", () => {
    const lines = problems(
      config({ evaluation: { metrics: ["answer_relevancy"] }, thresholds: {} }),
    );

    expect(lines[0]).toMatch(/^evaluation\.embeddings: is required because/);
    expect(lines[0]).toContain("answer_relevancy");
  });

  it("8. accepts answer_relevancy once embeddings are configured", () => {
    const lines = problems(
      config({
        evaluation: {
          metrics: ["answer_relevancy"],
          embeddings: { provider: "openai", model: "text-embedding-3-small" },
        },
        thresholds: {},
      }),
    );

    expect(lines).toEqual([]);
  });

  it("9. rejects a base_url that is not an absolute http(s) URL", () => {
    const lines = problems(
      config({
        evaluation: { judge: { provider: "openai", model: "m", base_url: "judge:11434" } },
      }),
    );

    expect(lines[0]).toMatch(/^evaluation\.judge\.base_url: must be an absolute http/);
  });

  it("10. accepts a base_url pointing at a self-hosted endpoint with no key", () => {
    const lines = problems(
      config({
        evaluation: {
          judge: {
            provider: "openai",
            model: "qwen3:14b",
            base_url: "http://judge-box:11434/v1",
            api_key_env: null,
          },
        },
      }),
    );

    expect(lines).toEqual([]);
  });

  it("11. rejects a threshold outside 0 to 1", () => {
    expect(problems(config({ thresholds: { mean_drop: { faithfulness: 5 } } }))).toContain(
      "thresholds.mean_drop.faithfulness: must be between 0 and 1",
    );
  });

  it("12. rejects an unknown baseline mode", () => {
    expect(problems(config({ baseline: { mode: "hybrid" } }))[0]).toMatch(
      /^baseline\.mode: must be "cached" or "dual"/,
    );
  });

  it("13. rejects an empty metrics list", () => {
    expect(problems(config({ evaluation: { metrics: [] }, thresholds: {} }))).toContain(
      "evaluation.metrics: must list at least one metric",
    );
  });

  it("14. rejects a missing required section, naming it", () => {
    const { dataset: _omitted, ...withoutDataset } = BASE;

    expect(problems(withoutDataset).some((line) => line.startsWith("dataset:"))).toBe(true);
  });

  it("15. reports every problem at once rather than stopping at the first", () => {
    expect(
      problems(config({ app: { startup_timeout: 5, port: 99999 } })).length,
    ).toBeGreaterThanOrEqual(2);
  });
});
