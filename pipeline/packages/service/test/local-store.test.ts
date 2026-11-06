import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { ServiceError } from "../src/errors.js";
import { FileJobStore, FileReportStore, acquireServiceLock } from "../src/local-store.js";
import type { EvaluationJob } from "../src/types.js";

const job: EvaluationJob = {
  id: `owner/rag-app:pr:7:${"a".repeat(40)}`,
  deliveryId: "delivery-1",
  installationId: 21,
  repository: {
    owner: "owner",
    name: "rag-app",
    fullName: "owner/rag-app",
    cloneUrl: "https://github.com/owner/rag-app.git",
  },
  commitSha: "a".repeat(40),
  ref: "refs/pull/7/head",
  pullRequestNumber: 7,
  baseSha: "b".repeat(40),
  isFork: false,
  secretsAllowed: true,
};

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "contextforge-local-store-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("FileJobStore", () => {
  it("persists jobs and deduplicates by delivery and job id", async () => {
    const directory = await temporaryDirectory();
    const store = await FileJobStore.create(directory);

    await expect(store.enqueueIfAbsent(job)).resolves.toEqual({ job, created: true });
    await expect(store.enqueueIfAbsent({ ...job, deliveryId: "delivery-2" })).resolves.toEqual({
      job,
      created: false,
    });
    await expect(
      store.enqueueIfAbsent({ ...job, id: "another-job", deliveryId: "delivery-1" }),
    ).resolves.toEqual({ job, created: false });

    const restarted = await FileJobStore.create(directory);
    await expect(restarted.listPending()).resolves.toEqual([job]);
  });

  it("releases interrupted claims on restart and persists completions", async () => {
    const directory = await temporaryDirectory();
    const store = await FileJobStore.create(directory);
    await store.enqueueIfAbsent(job);
    await expect(store.claim(job.id)).resolves.toEqual({ status: "acquired" });
    await expect(store.claim(job.id)).resolves.toEqual({ status: "busy" });

    const restarted = await FileJobStore.create(directory);
    await expect(restarted.listPending()).resolves.toEqual([job]);
    await expect(restarted.claim(job.id)).resolves.toEqual({ status: "acquired" });

    const completion = {
      checkRunId: 55,
      result: { status: "regression" as const, reportUrl: "https://reports.example.test/report/1" },
      notificationsDelivered: false,
    };
    await restarted.saveCompletion(job.id, completion);
    await expect(restarted.listPending()).resolves.toEqual([]);
    await restarted.release(job.id);
    const deliveryRetry = await FileJobStore.create(directory);
    await expect(deliveryRetry.listPending()).resolves.toEqual([job]);
    await expect(deliveryRetry.claim(job.id)).resolves.toEqual({
      status: "completed",
      completion,
    });
    await expect(deliveryRetry.claim(job.id)).resolves.toEqual({ status: "busy" });
    await deliveryRetry.markNotificationsDelivered(job.id);
    await expect(deliveryRetry.listPending()).resolves.toEqual([]);
  });
});

describe("service lock", () => {
  it("permits one service process to own the data directory", async () => {
    const directory = await temporaryDirectory();
    const release = await acquireServiceLock(directory);
    await expect(acquireServiceLock(directory)).rejects.toMatchObject({
      code: "SERVICE_ALREADY_RUNNING",
    } satisfies Partial<ServiceError>);

    await release();
    const releaseAgain = await acquireServiceLock(directory);
    await releaseAgain();
  });
});

describe("FileReportStore", () => {
  it("stores an HTML-escaped report behind a random HTTPS URL", async () => {
    const directory = await temporaryDirectory();
    const store = new FileReportStore(directory, "https://contextforge.example.test");
    const url = await store.put(job, "# <script>alert(1)</script>", '{"answer":"<unsafe>"}');
    const reportId = new URL(url).pathname.split("/").at(-1);
    expect(new URL(url).protocol).toBe("https:");
    expect(reportId).toMatch(/^[0-9a-f]{64}$/);

    const html = await store.read(reportId ?? "");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;unsafe&gt;");
    expect(await store.read("../jobs.json")).toBeNull();
  });

  it("does not mistake storage failures for missing reports", async () => {
    const file = path.join(await temporaryDirectory(), "not-a-directory");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(file, "file");
    const store = new FileReportStore(file, "https://contextforge.example.test");
    await expect(store.put(job, "report", "{}")).rejects.toBeInstanceOf(Error);
    await expect(readFile(file, "utf8")).resolves.toBe("file");
  });
});
