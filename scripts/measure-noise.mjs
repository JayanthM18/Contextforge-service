#!/usr/bin/env node
/**
 * Stage 6: measure the noise floor by comparing a commit against itself.
 *
 *   node scripts/measure-noise.mjs --config examples/contextforge.yml [--ref main] [--runs 5]
 *
 * Nothing changes between the two sides, so every movement in the scores is
 * noise — from the app's generation and from the judge. Default thresholds
 * must sit above it (docs/DESIGN.md section 4). Record the result, and the
 * judge that produced it, in docs/MEMORY.md.
 *
 * Needs Docker and a reachable judge. Build first: pnpm build.
 */

import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { loadConfig, measureNoise, readResultsFile } from "../packages/cli/dist/index.js";

const { values } = parseArgs({
  options: {
    config: { type: "string", default: "examples/contextforge.yml" },
    ref: { type: "string", default: "main" },
    runs: { type: "string", default: "5" },
    output: { type: "string", default: ".contextforge/noise" },
  },
});

const runs = Number(values.runs);
const bin = path.join(import.meta.dirname, "..", "packages", "cli", "dist", "bin.js");
const config = await loadConfig({ configPath: values.config, requireKeys: false });
const results = [];

for (let i = 1; i <= runs; i += 1) {
  const out = path.join(values.output, `run-${String(i)}`);
  process.stderr.write(
    `\n=== self-comparison ${String(i)} of ${String(runs)}: ${values.ref} vs ${values.ref} ===\n`,
  );
  const child = spawnSync(
    "node",
    [
      bin,
      "run",
      "--config",
      values.config,
      "--mode",
      "dual",
      "--baseline",
      values.ref,
      "--candidate",
      values.ref,
      "--output",
      out,
    ],
    { stdio: "inherit" },
  );
  // 0 and 1 are both verdicts; only 2 means the measurement itself failed.
  if (child.status === 2 || child.status === null) {
    process.stderr.write(
      `run ${String(i)} failed as a tool error; fix that before measuring noise\n`,
    );
    process.exit(2);
  }
  results.push(await readResultsFile(path.join(out, "results.json")));
}

const report = measureNoise(results, config.evaluation.metrics);
writeFileSync(path.join(values.output, "noise.json"), `${JSON.stringify(report, null, 2)}\n`);

const f = (v) => v.toFixed(3);
process.stdout.write(
  `\nNoise floor over ${String(report.runs)} self-comparisons, judge ${report.judge}\n\n`,
);
process.stdout.write(
  "metric              mean|Δ|  max|Δ|  case p95  case max  suggested mean_drop\n",
);
for (const m of report.metrics) {
  process.stdout.write(
    `${m.name.padEnd(20)}${f(m.meanAbsDelta).padStart(7)}${f(m.maxAbsDelta).padStart(8)}` +
      `${f(m.caseDropP95).padStart(10)}${f(m.caseDropMax).padStart(10)}${f(report.suggested.mean_drop[m.name]).padStart(21)}\n`,
  );
}
process.stdout.write(`\nsuggested case_drop: ${f(report.suggested.case_drop)}\n`);
process.stdout.write(
  `written to ${path.join(values.output, "noise.json")} — record it in docs/MEMORY.md\n`,
);
