/** Loading: file, YAML, environment and path checks. No network, no real env. */

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { loadConfig, resolveAgainstConfig } from "../src/config/load.js";
import { failure } from "./helpers.js";

const VALID_YAML = `
version: 1
app:
  compose_file: docker-compose.eval.yml
  service: rag-app
dataset:
  path: testcases.json
evaluation:
  metrics: [faithfulness]
  judge:
    provider: openai
    model: gpt-4o-mini
    api_key_env: OPENAI_API_KEY
thresholds:
  mean_drop:
    faithfulness: 0.05
`;

let dir = "";
const repoish = path.join(tmpdir(), "contextforge-elsewhere");
const env = { OPENAI_API_KEY: "sk-test" };

async function write(name: string, contents: string): Promise<string> {
  const file = path.join(dir, name);
  await writeFile(file, contents);
  return file;
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "contextforge-"));
  await writeFile(path.join(dir, "testcases.json"), "{}");
});

describe("loadConfig", () => {
  it("loads a valid config", async () => {
    const configPath = await write("valid.yml", VALID_YAML);
    const config = await loadConfig({ configPath, env });

    expect(config.version).toBe(1);
    expect(config.app.service).toBe("rag-app");
    expect(config.evaluation.judge.model).toBe("gpt-4o-mini");
  });

  it("shows an absolute path rather than a relative one that escapes the cwd", async () => {
    const error = await failure(
      loadConfig({ configPath: path.join(dir, "absent.yml"), env, cwd: repoish }),
    );

    expect(error.message).toContain(dir);
    expect(error.message).not.toContain("../..");
  });

  it("names the file when it cannot be read", async () => {
    const error = await failure(loadConfig({ configPath: path.join(dir, "absent.yml"), env }));

    expect(error.code).toBe("CONFIG_INVALID");
    expect(error.message).toContain("absent.yml");
    expect(error.remedy).toContain("--config");
  });

  it("reports malformed YAML with the line number", async () => {
    const configPath = await write("broken.yml", "version: 1\napp: [unclosed\n");
    const error = await failure(loadConfig({ configPath, env }));

    expect(error.message).toMatch(/is not valid YAML at line \d+/);
  });

  it("rejects an empty file rather than treating it as an empty config", async () => {
    const configPath = await write("empty.yml", "\n# just a comment\n");

    expect((await failure(loadConfig({ configPath, env }))).message).toContain("is empty");
  });

  it("lists every schema problem in one error", async () => {
    const configPath = await write(
      "bad.yml",
      VALID_YAML.replace("version: 1", "version: 3").replace("  service: rag-app", "  service: ''"),
    );
    const error = await failure(loadConfig({ configPath, env }));

    expect(error.message).toContain("2 problems");
    expect(error.message).toContain("version:");
    expect(error.message).toContain("app.service:");
  });

  it("uses the singular when there is one problem", async () => {
    const configPath = await write("one.yml", VALID_YAML.replace("version: 1", "version: 3"));

    expect((await failure(loadConfig({ configPath, env }))).message).toContain("1 problem");
  });

  it("fails when the variable named by api_key_env is not set", async () => {
    const configPath = await write("key.yml", VALID_YAML);
    const error = await failure(loadConfig({ configPath, env: {} }));

    expect(error.message).toContain("OPENAI_API_KEY");
    expect(error.remedy).toContain("api_key_env to null");
  });

  it("treats an empty variable as unset", async () => {
    const configPath = await write("key2.yml", VALID_YAML);

    expect(
      (await failure(loadConfig({ configPath, env: { OPENAI_API_KEY: "" } }))).message,
    ).toContain("is not set");
  });

  it("needs no key when api_key_env is null", async () => {
    const configPath = await write(
      "local.yml",
      VALID_YAML.replace(
        "    api_key_env: OPENAI_API_KEY",
        "    api_key_env: null\n    base_url: http://judge-box:11434/v1",
      ),
    );
    const config = await loadConfig({ configPath, env: {} });

    expect(config.evaluation.judge.base_url).toBe("http://judge-box:11434/v1");
  });

  it("fails when the dataset does not exist", async () => {
    const configPath = await write(
      "nodata.yml",
      VALID_YAML.replace("  path: testcases.json", "  path: missing.json"),
    );
    const error = await failure(loadConfig({ configPath, env }));

    expect(error.message).toContain("missing.json");
    expect(error.remedy).toContain("dataset generate");
  });

  it("skips the dataset check for dataset generate, which creates it", async () => {
    const configPath = await write(
      "gen.yml",
      VALID_YAML.replace("  path: testcases.json", "  path: missing.json"),
    );

    await expect(loadConfig({ configPath, env, requireDataset: false })).resolves.toBeDefined();
  });
});

describe("resolveAgainstConfig", () => {
  it("resolves relative to the config file, not the working directory", () => {
    expect(resolveAgainstConfig("/repo/user-repo/contextforge.yml", "sample-rag-app/x.yml")).toBe(
      "/repo/user-repo/sample-rag-app/x.yml",
    );
  });

  it("walks out of the config directory when the path does", () => {
    expect(resolveAgainstConfig("/repo/user-repo/contextforge.yml", "../benchmark/t.json")).toBe(
      "/repo/benchmark/t.json",
    );
  });

  it("leaves an absolute path alone", () => {
    expect(resolveAgainstConfig("/repo/user-repo/contextforge.yml", "/tmp/t.json")).toBe(
      "/tmp/t.json",
    );
  });
});
