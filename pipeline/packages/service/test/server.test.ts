import { generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { startLocalService } from "../src/server.js";

async function availablePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });
  const address = probe.address() as AddressInfo;
  await new Promise<void>((resolve, reject) => {
    probe.close((error) => {
      if (error === undefined) resolve();
      else reject(error);
    });
  });
  return address.port;
}

describe("local service entrypoint", () => {
  it("starts with a valid GitHub App key and serves health checks", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "contextforge-local-server-test-"));
    const repositoryPath = path.join(root, "repository");
    const cliPath = path.join(root, "cli.js");
    const dataDirectory = path.join(root, "data");
    const port = await availablePort();
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    let close: (() => Promise<void>) | undefined;

    try {
      await mkdir(repositoryPath);
      await writeFile(cliPath, "");
      close = await startLocalService({
        GITHUB_APP_ID: "12345",
        GITHUB_APP_PRIVATE_KEY: privateKey,
        CONTEXTFORGE_WEBHOOK_SECRET: "test-secret",
        CONTEXTFORGE_GITHUB_REPOSITORY: "owner/rag-app",
        CONTEXTFORGE_REPOSITORY_PATH: repositoryPath,
        CONTEXTFORGE_CLI_PATH: cliPath,
        CONTEXTFORGE_DATA_DIR: dataDirectory,
        CONTEXTFORGE_PUBLIC_URL: "https://contextforge.example.test",
        CONTEXTFORGE_HOST: "127.0.0.1",
        CONTEXTFORGE_PORT: String(port),
      });

      const response = await fetch(`http://127.0.0.1:${String(port)}/health`);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ status: "ok" });
    } finally {
      if (close !== undefined) await close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
