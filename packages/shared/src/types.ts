/**
 * Types shared across packages. Result and benchmark types land here in later
 * stages (see `docs/DESIGN.md` sections 3 and 4); a type must never be
 * redeclared in both `cli` and `action`.
 */

/**
 * Process exit codes, fixed by `docs/DESIGN.md` section 6. CI needs to tell
 * "the quality regressed" apart from "the tool broke", so a regression and a
 * tool error must never share a code.
 */
export const EXIT_CODE = {
  /** The run passed every threshold. */
  pass: 0,
  /** The run completed and found a regression. */
  regression: 1,
  /** ContextForge itself failed: bad config, unreachable app, broken judge. */
  toolError: 2,
} as const;

export type ExitCode = (typeof EXIT_CODE)[keyof typeof EXIT_CODE];
