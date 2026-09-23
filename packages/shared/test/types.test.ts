import { describe, expect, it } from "vitest";

import { EXIT_CODE } from "../src/types.js";

describe("EXIT_CODE", () => {
  it("matches the codes fixed by docs/DESIGN.md section 6", () => {
    expect(EXIT_CODE).toEqual({ pass: 0, regression: 1, toolError: 2 });
  });

  it("gives a regression and a tool error distinct codes", () => {
    expect(EXIT_CODE.regression).not.toBe(EXIT_CODE.toolError);
  });
});
