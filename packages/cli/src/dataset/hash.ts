/**
 * Content hashing for fingerprints. The hash covers meaning, not formatting:
 * re-indenting testcases.json or reordering its keys must not invalidate
 * every stored benchmark, but changing a question must.
 */

import { createHash } from "node:crypto";

/** JSON with object keys sorted at every level, so equal data prints equally. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256(content: string | Buffer): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

export function hashData(value: unknown): string {
  return sha256(canonicalJson(value));
}
