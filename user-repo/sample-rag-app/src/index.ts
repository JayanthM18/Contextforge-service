/**
 * Entry point. The server listens before the index is built so the runner's
 * health poll gets an honest "starting" instead of a connection refusal.
 */

import { ConfigError, loadConfig } from "./config.ts";
import { log } from "./log.ts";
import { buildPipeline, type Pipeline } from "./pipeline.ts";
import { createServer } from "./server.ts";

async function main(): Promise<void> {
  const config = loadConfig();

  // A holder rather than a bare binding: the server is created before the
  // index exists, and readiness is exactly "has this been filled in yet".
  const state: { pipeline?: Pipeline } = {};

  const server = createServer({
    isReady: () => state.pipeline !== undefined,
    answer: async (question) => {
      if (state.pipeline === undefined) throw new Error("The index is still building.");
      return state.pipeline.answer(question);
    },
  });

  server.listen(config.port, () => {
    log("listening", { port: config.port, provider: config.provider });
  });

  const shutdown = (signal: string): void => {
    log("shutting down", { signal });
    server.close(() => {
      process.exit(0);
    });
  };
  process.on("SIGTERM", () => {
    shutdown("SIGTERM");
  });
  process.on("SIGINT", () => {
    shutdown("SIGINT");
  });

  state.pipeline = await buildPipeline(config);
  log("ready", { chunks: state.pipeline.chunkCount });
}

try {
  await main();
} catch (error: unknown) {
  if (error instanceof ConfigError) {
    process.stderr.write(`Configuration error: ${error.message}\n`);
    process.exit(2);
  }
  process.stderr.write(
    `Startup failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exit(1);
}
