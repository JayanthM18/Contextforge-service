# Development rules

## General principles

- **One stage at a time.** Work only on the current stage in `docs/TASKS.md`.
  Finishing early is not a reason to start the next one.
- **Plan, then build.** Propose the files and the approach, get approval, then
  write code. Most bad output comes from a bad plan that was skimmed.
- **Specs win.** If code and `docs/DESIGN.md` disagree, the doc is right until
  it is deliberately changed. Ambiguity is a stop condition, not a guess.
- **Run what you claim.** No task is done until its tests have been executed
  and seen to pass.
- **Small, reviewable changes.** One concern per commit. A change you cannot
  explain in a viva does not belong in the repo.
- **Fail loudly and usefully.** Every error a user can hit names the file, key
  or container that caused it and what to do next.
- **No silent fallbacks.** If the tool rebuilds a missing or incompatible
  baseline, or skips a case, it says so in the report.
- **Measure before tuning.** Thresholds and defaults come from measured noise,
  not from intuition.

## Technology rules

- TypeScript strict mode. No `any` and no non-null assertions at module
  boundaries; if a type is genuinely unknown, parse it with Zod.
- Node 20, pnpm workspaces. No global installs; all scripts run from the root.
- Python only inside `pipeline/evaluator/`. The TypeScript core talks to it over a JSON
  file interface, never by importing Python or shelling into a venv.
- Docker for every app run. Never evaluate an app running on the host.
- No network calls in unit tests. Fixtures for LLM responses; real API calls
  only in a clearly marked integration test that can be skipped.
- Secrets from environment variables only. `.env` is git-ignored;
  `.env.example` documents the names.
- Pin versions: exact Docker base image tags, a committed lockfile, and an
  explicit judge model and version in config.
- Dependencies are a decision. Prefer the standard library or a few lines of
  our own code over a package that does one small thing.

## Coding standards

- Pure functions for anything that can be pure: comparison, thresholds,
  verdicts, report rendering. I/O stays in the runner, config loader and
  evaluator client.
- Every module has a sibling test file. New behaviour ships with tests in the
  same commit.
- Name things after the domain: `baseline`, `candidate`, `case`, `verdict`,
  `fingerprint`. Do not invent synonyms across modules.
- Types shared between packages live in `pipeline/packages/shared/src/types.ts`. Do not
  redeclare a result type in two places.
- Errors: throw typed errors with a `code` and a human message. No bare
  `throw new Error("failed")`.
- Logging: one structured logger, levels used honestly. No `console.log` left
  in committed code.
- Async: `async`/`await` only, no raw `.then` chains. Every spawned container
  is torn down in a `finally`.
- Comments explain *why*, never *what*. If the what needs a comment, rename
  things instead.
- Formatting and linting are automated. Never argue with the formatter.

## Git and review

- Conventional commits: `feat:`, `fix:`, `docs:`, `test:`, `refactor:`,
  `chore:`.
- One branch per stage or task, merged after the stage gate passes.
- Every PR body states the stage, what changed, and how it was verified.
- `docs/MEMORY.md` is appended to at the end of each session, before the PR is
  opened.
