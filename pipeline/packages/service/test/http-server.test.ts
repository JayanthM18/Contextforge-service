import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it, vi } from "vitest";

import { createWebhookServer } from "../src/http.js";

describe("local HTTP server routes", () => {
  it("serves health and a stored report, but returns 404 for unknown reports", async () => {
    const server = createWebhookServer(
      {
        webhookSecret: "test-secret",
        jobs: { enqueueIfAbsent: (job) => Promise.resolve({ job, created: true }) },
        logger: { error: vi.fn() },
      },
      { read: (id) => Promise.resolve(id === "a".repeat(64) ? "<html>report</html>" : null) },
    );
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;

    try {
      const base = `http://127.0.0.1:${String(address.port)}`;
      const health = await fetch(`${base}/health`);
      expect(health.status).toBe(200);
      await expect(health.json()).resolves.toEqual({ status: "ok" });

      const report = await fetch(`${base}/reports/${"a".repeat(64)}`);
      expect(report.status).toBe(200);
      expect(report.headers.get("content-security-policy")).toBe(
        "default-src 'none'; style-src 'unsafe-inline'",
      );
      await expect(report.text()).resolves.toBe("<html>report</html>");

      const missing = await fetch(`${base}/reports/${"b".repeat(64)}`);
      expect(missing.status).toBe(404);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => {
          if (error === undefined) resolve();
          else reject(error);
        }),
      );
    }
  });

  it("serves the real-job dashboard only to loopback hosts", async () => {
    const jobs = [
      {
        repository: "owner/rag-app",
        commitSha: "a".repeat(40),
        pullRequestNumber: 7,
        status: "completed" as const,
        result: {
          status: "pass" as const,
          reportUrl: "https://reports.example.test/report/secret",
        },
      },
    ];
    const server = createWebhookServer(
      {
        webhookSecret: "test-secret",
        jobs: { enqueueIfAbsent: (job) => Promise.resolve({ job, created: true }) },
        logger: { error: vi.fn() },
      },
      undefined,
      { listDashboardJobs: () => Promise.resolve(jobs) },
    );
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;

    try {
      const base = `http://127.0.0.1:${String(address.port)}`;
      const page = await fetch(base);
      expect(page.status).toBe(200);
      expect(page.headers.get("cache-control")).toBe("no-store");
      expect(page.headers.get("content-security-policy")).toContain("connect-src 'self'");
      await expect(page.text()).resolves.toContain("Waiting for a pull-request webhook");

      const response = await fetch(`${base}/api/jobs`);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      await expect(response.json()).resolves.toEqual({ jobs });

      const external = await new Promise<{ statusCode: number | undefined; body: string }>(
        (resolve, reject) => {
          const request = httpRequest(
            `${base}/api/jobs`,
            { headers: { host: "demo.trycloudflare.com" } },
            (response) => {
              let body = "";
              response.setEncoding("utf8");
              response.on("data", (chunk: string) => {
                body += chunk;
              });
              response.on("end", () => {
                resolve({ statusCode: response.statusCode, body });
              });
            },
          );
          request.on("error", reject);
          request.end();
        },
      );
      expect(external.statusCode).toBe(403);
      expect(JSON.parse(external.body) as unknown).toEqual({
        error: "local_dashboard_only",
      });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => {
          if (error === undefined) resolve();
          else reject(error);
        }),
      );
    }
  });
});
