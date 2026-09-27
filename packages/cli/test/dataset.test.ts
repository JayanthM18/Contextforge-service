import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { datasetSchema, type Dataset } from "@contextforge/shared";
import { beforeEach, describe, expect, it } from "vitest";

import { datasetGenerateCommand } from "../src/commands/dataset.js";
import { assertWritable, datasetHash, loadDataset, writeDataset } from "../src/dataset/freeze.js";
import { buildGenerateRequest, readSourceDocuments, toDataset } from "../src/dataset/generate.js";
import { canonicalJson, hashData } from "../src/dataset/hash.js";
import { ContextForgeError } from "../src/util/errors.js";
import { fakeExec, silentLogger, testConfig } from "./helpers.js";

let dir = "";
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "contextforge-dataset-"));
});

const dataset: Dataset = {
  dataset_version: 1,
  generated_at: "2026-09-27T00:00:00Z",
  generator: { tool: "ragas", version: "0.4.3", model: "m" },
  cases: [
    {
      id: "tc-001",
      question: "q?",
      ground_truth: "t",
      reference_context_ids: ["a.md"],
      hops: "single",
    },
  ],
};

async function failure(promise: Promise<unknown> | (() => unknown)): Promise<ContextForgeError> {
  try {
    await (typeof promise === "function" ? promise() : promise);
  } catch (error: unknown) {
    if (error instanceof ContextForgeError) return error;
    throw error;
  }
  throw new Error("expected a ContextForgeError");
}

describe("canonicalJson and hashing", () => {
  it("ignores key order", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(
      canonicalJson({ a: { c: 3, d: 2 }, b: 1 }),
    );
  });

  it("keeps array order, which is meaningful", () => {
    expect(hashData([1, 2])).not.toBe(hashData([2, 1]));
  });

  it("produces a prefixed sha256", () => {
    expect(hashData({})).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("ignores the generation timestamp but not a changed question", () => {
    const later = { ...dataset, generated_at: "2030-01-01T00:00:00Z" };
    const [first] = dataset.cases;
    if (first === undefined) throw new Error("fixture has no cases");
    const changed = { ...dataset, cases: [{ ...first, question: "different?" }] };

    expect(datasetHash(later)).toBe(datasetHash(dataset));
    expect(datasetHash(changed)).not.toBe(datasetHash(dataset));
  });
});

describe("loadDataset", () => {
  it("loads a valid test set", async () => {
    const file = path.join(dir, "t.json");
    await writeFile(file, JSON.stringify(dataset));

    expect((await loadDataset(file)).cases).toHaveLength(1);
  });

  it("names the offending case and field", async () => {
    const file = path.join(dir, "t.json");
    await writeFile(
      file,
      JSON.stringify({ ...dataset, cases: [{ ...dataset.cases[0], hops: "triple" }] }),
    );

    expect((await failure(loadDataset(file))).message).toContain("cases.0.hops");
  });

  it("rejects duplicate case ids", async () => {
    const file = path.join(dir, "t.json");
    await writeFile(
      file,
      JSON.stringify({ ...dataset, cases: [dataset.cases[0], dataset.cases[0]] }),
    );

    expect((await failure(loadDataset(file))).message).toContain("appears more than once");
  });

  it("points a missing file at dataset generate", async () => {
    expect((await failure(loadDataset(path.join(dir, "nope.json")))).remedy).toContain(
      "dataset generate",
    );
  });
});

describe("writing the frozen set", () => {
  it("refuses to replace an existing set without --overwrite", async () => {
    const file = path.join(dir, "t.json");
    await writeFile(file, "{}");

    const error = await failure(() => {
      assertWritable(file, { overwrite: false });
    });
    expect(error.remedy).toContain("--overwrite");
  });

  it("writes nothing when only checking", () => {
    const file = path.join(dir, "absent.json");
    assertWritable(file, { overwrite: false });

    expect(existsSync(file)).toBe(false);
  });

  it("creates missing directories", async () => {
    const file = path.join(dir, "benchmark", "t.json");
    await writeDataset(file, dataset, { overwrite: false });

    expect(datasetSchema.parse(JSON.parse(await readFile(file, "utf8")))).toEqual(dataset);
  });
});

describe("readSourceDocuments", () => {
  it("reads text documents recursively in a stable order, ignoring others", async () => {
    await mkdir(path.join(dir, "sub"));
    await writeFile(path.join(dir, "b.md"), "beta");
    await writeFile(path.join(dir, "a.txt"), "alpha");
    await writeFile(path.join(dir, "sub", "c.markdown"), "gamma");
    await writeFile(path.join(dir, "image.png"), "binary");
    await writeFile(path.join(dir, "empty.md"), "   ");

    expect((await readSourceDocuments(dir)).map((d) => d.id)).toEqual([
      "a.txt",
      "b.md",
      "sub/c.markdown",
    ]);
  });

  it("fails when there is nothing to generate from", async () => {
    expect((await failure(readSourceDocuments(dir))).message).toContain("No documents found");
  });
});

describe("buildGenerateRequest and toDataset", () => {
  it("uses the judge endpoint and the requested size", () => {
    const request = buildGenerateRequest(testConfig(), [{ id: "a.md", text: "x" }], 20);

    expect(request).toMatchObject({
      task: "generate",
      size: 20,
      judge: { model: "gpt-4o-mini", temperature: 0 },
    });
  });

  it("numbers cases in order, padded so they sort", () => {
    const response = {
      generator: { tool: "ragas", version: "0.4.3", model: "m" },
      cases: Array.from({ length: 12 }, (_, i) => ({
        question: `q${String(i)}?`,
        ground_truth: "t",
        reference_document_ids: [],
        hops: "single" as const,
      })),
    };
    const result = toDataset(response, new Date("2026-09-27T10:00:00.123Z"));

    expect(result.cases[0]?.id).toBe("tc-001");
    expect(result.cases[11]?.id).toBe("tc-012");
    expect(result.generated_at).toBe("2026-09-27T10:00:00Z");
    expect(datasetSchema.safeParse(result).success).toBe(true);
  });
});

describe("dataset generate", () => {
  async function project(): Promise<string> {
    await mkdir(path.join(dir, "docs"));
    await writeFile(path.join(dir, "docs", "refunds.md"), "Refunds within 30 days.");
    const configPath = path.join(dir, "contextforge.yml");
    await writeFile(
      configPath,
      [
        "version: 1",
        "app: { compose_file: c.yml, service: s }",
        "dataset: { path: benchmark/testcases.json, source_docs: docs }",
        "evaluation:",
        "  metrics: [faithfulness]",
        "  judge: { provider: openai, model: m, api_key_env: null }",
        "  embeddings: { provider: openai, model: e, api_key_env: null }",
        "baseline: {}",
        "thresholds: {}",
        "report: {}",
      ].join("\n"),
    );
    return configPath;
  }

  it("refuses an existing test set before starting Docker", async () => {
    const configPath = await project();
    await mkdir(path.join(dir, "benchmark"));
    await writeFile(path.join(dir, "benchmark", "testcases.json"), "{}");
    const { exec, calls } = fakeExec();

    const error = await failure(
      datasetGenerateCommand({
        configPath,
        overwrite: false,
        exec,
        logger: silentLogger,
        env: {},
        user: null,
      }),
    );

    expect(error.message).toContain("already exists");
    expect(calls).toEqual([]);
  });

  it("writes a numbered draft from the evaluator's cases", async () => {
    const configPath = await project();
    const { exec } = fakeExec(async (_command, args) => {
      if (args[0] !== "run") return { code: 0 };
      const workdir = (args[args.indexOf("--volume") + 1] ?? "").split(":")[0] ?? "";
      await writeFile(
        path.join(workdir, "response.json"),
        JSON.stringify({
          generator: { tool: "ragas", version: "0.4.3", model: "m" },
          cases: [
            {
              question: "Refund window?",
              ground_truth: "30 days",
              reference_document_ids: ["refunds.md"],
              hops: "single",
            },
          ],
        }),
      );
      return { code: 0 };
    });

    const written = await datasetGenerateCommand({
      configPath,
      overwrite: false,
      exec,
      logger: silentLogger,
      env: { CONTEXTFORGE_EVALUATOR_IMAGE: "img" },
      user: null,
      now: () => new Date("2026-09-27T00:00:00Z"),
    });

    const result = await loadDataset(written);
    expect(result.cases).toEqual([
      {
        id: "tc-001",
        question: "Refund window?",
        ground_truth: "30 days",
        reference_context_ids: ["refunds.md"],
        hops: "single",
      },
    ]);
  });

  it("fails rather than writing an empty test set", async () => {
    const configPath = await project();
    const { exec } = fakeExec(async (_command, args) => {
      if (args[0] !== "run") return { code: 0 };
      const workdir = (args[args.indexOf("--volume") + 1] ?? "").split(":")[0] ?? "";
      await writeFile(
        path.join(workdir, "response.json"),
        JSON.stringify({ generator: { tool: "ragas", version: "0.4.3", model: "m" }, cases: [] }),
      );
      return { code: 0 };
    });

    const error = await failure(
      datasetGenerateCommand({
        configPath,
        overwrite: false,
        exec,
        logger: silentLogger,
        env: { CONTEXTFORGE_EVALUATOR_IMAGE: "img" },
        user: null,
      }),
    );

    expect(error.message).toContain("no usable cases");
    expect(existsSync(path.join(dir, "benchmark", "testcases.json"))).toBe(false);
  });
});
