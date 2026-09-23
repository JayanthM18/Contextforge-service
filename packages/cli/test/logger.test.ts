import { beforeEach, describe, expect, it } from "vitest";

import { createLogger, isLogLevel } from "../src/util/logger.js";

describe("createLogger", () => {
  let lines: string[];
  const write = (line: string): void => {
    lines.push(line);
  };

  beforeEach(() => {
    lines = [];
  });

  it("drops lines below the configured level", () => {
    const log = createLogger({ level: "warn", write });

    log.debug("a");
    log.info("b");
    log.warn("c");
    log.error("d");

    expect(lines).toEqual(["WARN  c", "ERROR d"]);
  });

  it("writes nothing at level silent", () => {
    const log = createLogger({ level: "silent", write });

    log.error("boom");

    expect(lines).toEqual([]);
  });

  it("appends structured fields to the text line", () => {
    const log = createLogger({ level: "info", write });

    log.info("container started", { service: "rag-app", port: 8000 });

    expect(lines).toEqual(["INFO  container started service=rag-app port=8000"]);
  });

  it("emits one JSON object per line in json format", () => {
    const log = createLogger({ level: "info", format: "json", write });

    log.info("scored", { case_id: "tc-001" });

    expect(JSON.parse(lines[0] ?? "")).toEqual({
      level: "info",
      message: "scored",
      case_id: "tc-001",
    });
  });

  it("stamps a child's bound fields onto every line", () => {
    const log = createLogger({ level: "info", write }).child({ run: "candidate" });

    log.info("querying", { case_id: "tc-001" });

    expect(lines).toEqual(["INFO  querying run=candidate case_id=tc-001"]);
  });

  it("lets a call-site field override a bound one", () => {
    const log = createLogger({ level: "info", write }).child({ run: "candidate" });

    log.info("querying", { run: "baseline" });

    expect(lines).toEqual(["INFO  querying run=baseline"]);
  });

  it("recognises valid log levels", () => {
    expect(isLogLevel("debug")).toBe(true);
    expect(isLogLevel("verbose")).toBe(false);
    expect(isLogLevel(3)).toBe(false);
  });
});
