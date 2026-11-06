/** Asking the app every question in the test set. */

import type { CaseRecord, TestCase } from "@contextforge/shared";

import type { Logger } from "../util/logger.js";
import { queryResponseSchema } from "./contract.js";

export interface QueryOptions {
  readonly baseUrl: string;
  readonly queryPath: string;
  readonly timeoutMs: number;
  readonly fetch?: typeof fetch;
  readonly logger: Logger;
}

function failed(testCase: TestCase, error: string, latency: number | null): CaseRecord {
  return {
    case_id: testCase.id,
    question: testCase.question,
    status: "failed",
    error,
    answer: null,
    contexts: [],
    scores: {},
    scores_stddev: {},
    score_errors: {},
    latency_ms: latency,
  };
}

/**
 * One question. A non-2xx response, a timeout, or a body that breaks the
 * contract fails this case only (docs/DESIGN.md section 1) — the run goes on.
 */
export async function queryCase(testCase: TestCase, options: QueryOptions): Promise<CaseRecord> {
  const post = options.fetch ?? fetch;
  const started = performance.now();
  const elapsed = (): number => Math.round(performance.now() - started);

  let response: Response;
  try {
    response = await post(`${options.baseUrl}${options.queryPath}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: testCase.question }),
      signal: AbortSignal.timeout(options.timeoutMs),
    });
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    return failed(testCase, `request failed: ${reason}`, elapsed());
  }

  const body = await response.text();
  const latency = elapsed();
  if (!response.ok) {
    return failed(testCase, `HTTP ${String(response.status)}: ${body.slice(0, 300)}`, latency);
  }

  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return failed(testCase, `response is not JSON: ${body.slice(0, 300)}`, latency);
  }

  const parsed = queryResponseSchema.safeParse(json);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`);
    return failed(testCase, `response breaks the app contract — ${problems.join("; ")}`, latency);
  }

  return {
    case_id: testCase.id,
    question: testCase.question,
    status: "ok",
    error: null,
    answer: parsed.data.answer,
    contexts: parsed.data.contexts.map((context) => ({
      id: context.id ?? null,
      text: context.text,
    })),
    scores: {},
    scores_stddev: {},
    score_errors: {},
    // The app's own figure excludes network and queueing, so prefer it.
    latency_ms: parsed.data.metadata?.latency_ms ?? latency,
  };
}

/**
 * Every case, one at a time. Sequential on purpose: concurrent requests would
 * make latency depend on how many other questions happened to be in flight.
 */
export async function queryAll(
  cases: readonly TestCase[],
  options: QueryOptions,
): Promise<CaseRecord[]> {
  const records: CaseRecord[] = [];
  for (const [index, testCase] of cases.entries()) {
    const record = await queryCase(testCase, options);
    if (record.status === "failed") {
      options.logger.warn("case failed", { case: testCase.id, error: record.error });
    }
    if ((index + 1) % 10 === 0 || index + 1 === cases.length) {
      options.logger.info("queried", { done: index + 1, total: cases.length });
    }
    records.push(record);
  }
  return records;
}
