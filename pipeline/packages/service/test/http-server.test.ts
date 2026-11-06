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
});
