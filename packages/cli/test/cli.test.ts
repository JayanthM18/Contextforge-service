/**
 * Exit codes are a contract with CI (`docs/DESIGN.md` section 6): 0 pass,
 * 1 regression, 2 tool error. A tool error must never be reported as a
 * regression, or a broken container looks like a quality drop.
 */

import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { run } from "../src/cli.js";
import { EXIT_CODE } from "@contextforge/shared";

const repoRoot = path.join(import.meta.dirname, "..", "..", "..");
const exampleConfig = path.join(repoRoot, "examples", "contextforge.yml");

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("run", () => {
  it("exits 0 for --help", async () => {
    await expect(run(["--help"])).resolves.toBe(EXIT_CODE.pass);
  });

  it("exits 0 for --version", async () => {
    await expect(run(["--version"])).resolves.toBe(EXIT_CODE.pass);
  });

  it("exits 2, not 1, for an unknown command", async () => {
    const code = await run(["nonsense"]);

    expect(code).toBe(EXIT_CODE.toolError);
    expect(code).not.toBe(EXIT_CODE.regression);
  });

  it("exits 2 when --config is missing", async () => {
    await expect(run(["validate"])).resolves.toBe(EXIT_CODE.toolError);
  });

  it("exits 2 when the config file does not exist", async () => {
    await expect(run(["validate", "--config", "no/such.yml"])).resolves.toBe(EXIT_CODE.toolError);
  });

  it("exits 2 for an unknown --log-level", async () => {
    await expect(
      run(["--log-level", "chatty", "validate", "--config", exampleConfig]),
    ).resolves.toBe(EXIT_CODE.toolError);
  });

  it("exits 0 validating the reference config", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");

    await expect(
      run(["--log-level", "silent", "validate", "--config", exampleConfig]),
    ).resolves.toBe(EXIT_CODE.pass);
  });

  it("exits 2 when the reference config's key variable is unset", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");

    await expect(
      run(["--log-level", "silent", "validate", "--config", exampleConfig]),
    ).resolves.toBe(EXIT_CODE.toolError);
  });
});
