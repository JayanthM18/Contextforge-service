# Memory

Append-only log of what changed and why. Newest entry at the top. Never delete
an entry; correct it with a later one. Every session and every stage gate adds
an entry here before the pull request is opened.

## Format

```
## YYYY-MM-DD — stage N — short title

**Changed:** files or modules touched, in one or two lines
**Why:** the reason, not the diff
**Decisions:** any choice a future reader would question
**Deferred:** what was deliberately left undone
**Notes:** surprises, measurements, things that cost time
```

---

## Current state

- **Stage:** 0 — scaffold, complete and awaiting the gate review
- **Works:** `pnpm install`, `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build`
  from a clean tree. 14 tests across 3 files. No product functionality.
- **Known gaps:** no CLI binary, no config loader, no sample app, no evaluator
- **Measured noise floor:** not measured yet (stage 6)

---

## 2026-09-23 — stage 0 — scaffold

**Changed:** workspace root (`package.json`, `pnpm-workspace.yaml`,
`tsconfig.base.json`, `tsconfig.json`, `tsconfig.eslint.json`,
`vitest.config.ts`, `eslint.config.js`, `.prettierrc.json`, `.prettierignore`,
`.gitignore`, `.nvmrc`, `.env.example`, `README.md`), three workspace packages
(`shared`, `cli`, `action`), `.github/workflows/ci.yml`, and `git init`.
**Why:** stage 0 in `docs/TASKS.md` — a workspace that lints, typechecks and
tests from a clean clone, with no product code.
**Decisions:**
- Docs folder renamed `Docs/` → `docs/` to match every path in `CLAUDE.md`,
  `docs/ARCHITECTURE.md` and this file. The filesystem is case-sensitive, so
  the capitalised name would have broken those references.
- Node 26 locally (`.nvmrc`), `engines` left at `>=20` and CI pinned to 26.
  `docs/ARCHITECTURE.md` says Node 20; nothing in the scaffold depends on a
  version-specific API, so the doc stays accurate as a floor.
- pnpm is run via `npx pnpm@10.34.5` rather than installed globally, because
  `docs/RULES.md` forbids global installs and `corepack` is not bundled with
  Node 26. `packageManager` pins the exact version for `pnpm/action-setup`.
- `packages/cli/src/util/{errors,logger}.ts` were written now even though
  stage 0 says "no product code". They are infrastructure every later stage
  needs, `docs/RULES.md` mandates their exact shape (typed errors with a
  `code`, one structured logger, no `console.log`), and without them the
  `no-console` rule has no sanctioned escape hatch. Called out here because it
  is a deliberate stretch of the stage boundary, not an oversight.
- Exit codes (`0` pass, `1` regression, `2` tool error, `docs/DESIGN.md` §6)
  live in `packages/shared` because the CLI and the Action both need them.
- The logger writes to stderr only, so `results.json` on stdout stays clean
  for CI to pipe.
- Prettier ignores `docs/`, `CLAUDE.md` and `README.md`: they are hand-wrapped
  prose and reflowing them would wreck spec diffs.
- Type-aware linting needs a project that covers tests and root configs, which
  the per-package build configs exclude. Hence `tsconfig.eslint.json`; without
  it ESLint silently fell back to a default project with `strictNullChecks`
  off and half the strict rules disabled themselves.
**Deferred:** CLI binary and Commander wiring (stage 2), `packages/action/action.yml`
(stage 8), `evaluator/`, `examples/` and `benchmark/` directories (stages 1–4),
the `benchmark.yml` and `pr-check.yml` workflows (stages 7–8), a coverage
threshold (nothing meaningful to cover yet). Judge model still not pinned and
the benchmark store location is still undecided, both carried over from the
previous entry.
**Notes:**
- `pnpm` 10 blocks dependency build scripts by default; Vitest silently failed
  to resolve esbuild's binary until `esbuild` was added to
  `onlyBuiltDependencies` in `pnpm-workspace.yaml`.
- Verified rather than assumed: a probe file using `any`, `console.log` and a
  non-null assertion was linted and produced errors on all three, then deleted.
- Full gate run on a wiped `node_modules`: install (frozen lockfile), build,
  14 tests passing, lint and format clean, typecheck clean.
- Vitest 5 and `@types/node` 26 were chosen over the versions first installed;
  starting a project two majors behind is a cost paid later for nothing.

---

## 2026-09-23 — stage 0 — project docs written

**Changed:** `CLAUDE.md`, `docs/PRD.md`, `docs/ARCHITECTURE.md`,
`docs/RULES.md`, `docs/DESIGN.md`, `docs/TASKS.md`, `docs/MEMORY.md`
**Why:** specs before code, so the staged plan and the app contract are settled
before any implementation starts
**Decisions:**
- Baseline is cached by default, with a dual-environment fallback. Dual mode is
  the correctness reference; cached mode is the optimisation and must agree
  with it.
- The stored benchmark keeps answers and contexts, not only scores, so a judge
  change can be handled by re-scoring stored text instead of rebuilding the app.
- Baseline is looked up by the pull request's merge base, not the tip of main,
  so a PR is not blamed for changes merged after it branched.
- The dataset is frozen and committed; regenerating it is an explicit command.
**Deferred:** judge model not yet pinned; benchmark store location (results
branch versus Actions cache) not yet decided
**Notes:** the app contract in `docs/DESIGN.md` is the load-bearing spec — the
runner, evaluator and sample app all depend on it
