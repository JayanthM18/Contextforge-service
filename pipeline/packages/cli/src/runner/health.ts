/** Waiting for the app to report ready. */

import { ContextForgeError } from "../util/errors.js";

export interface WaitOptions {
  readonly url: string;
  readonly timeoutMs: number;
  readonly intervalMs?: number;
  readonly fetch?: typeof fetch;
  /** False once the container has exited, so a crash fails fast rather than at the timeout. */
  readonly isRunning?: () => Promise<boolean>;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Poll `url` until it returns 200. A refused connection or a 503 while the
 * app is loading is normal and keeps polling; running out of time or the
 * container exiting is a failure.
 */
export async function waitForHealthy(options: WaitOptions): Promise<void> {
  const get = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? realSleep;
  const interval = options.intervalMs ?? 1_000;
  const deadline = now() + options.timeoutMs;
  let last = "no response yet";

  for (;;) {
    try {
      const response = await get(options.url, { signal: AbortSignal.timeout(5_000) });
      if (response.status === 200) return;
      last = `HTTP ${String(response.status)}`;
    } catch (error: unknown) {
      last = error instanceof Error ? error.message : String(error);
    }

    if (options.isRunning !== undefined && !(await options.isRunning())) {
      throw new ContextForgeError(
        "APP_FAILED",
        "The app container exited before it became healthy",
        {
          remedy: `The last health check said: ${last}. See the container logs below.`,
        },
      );
    }

    if (now() >= deadline) {
      throw new ContextForgeError(
        "APP_FAILED",
        `The app did not become healthy within ${String(Math.round(options.timeoutMs / 1000))}s`,
        {
          remedy:
            `The last health check at ${options.url} said: ${last}. ` +
            "Raise app.startup_timeout if the app is slow to start, or check the logs below.",
        },
      );
    }
    await sleep(interval);
  }
}
