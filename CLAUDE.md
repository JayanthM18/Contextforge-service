# ContextForge — working instructions

CI regression-testing tool for RAG applications. A change to a RAG pipeline
(chunking, embeddings, retrieval, prompts, models) can silently degrade answer
quality without breaking anything. ContextForge runs a frozen evaluation set
against the PR branch, compares the scores to a stored baseline, and reports
pass/fail on the pull request.

## Read these first, in this order

| File | What it is | When to read |
|---|---|---|
| `pipeline/docs/PRD.md` | Product requirements: problem, goals, users, MVP scope | Before proposing any feature |
| `pipeline/docs/ARCHITECTURE.md` | App flow, tech stack, folder structure | Before creating files |
| `pipeline/docs/RULES.md` | Principles, technology rules, coding standards | Before writing code |
| `pipeline/docs/DESIGN.md` | Detailed specs: app contract, config schema, benchmark format, report format | Before implementing any module |
| `pipeline/docs/TASKS.md` | Staged plan, exit criteria, current stage | Every session, to know what to work on |
| `pipeline/docs/MEMORY.md` | Log of changes and decisions | At the start and end of every session |

## Working agreement

- Work on the current stage in `pipeline/docs/TASKS.md` only. Do not start later stages.
- Plan before coding: list the files you would create or change and the
  approach, then wait for approval.
- Run `pnpm test` before claiming anything is done. Never report success on
  code you have not run.
- Append to `pipeline/docs/MEMORY.md` at the end of every session: what changed, what
  was deferred, anything that surprised you.
- If a spec is ambiguous, wrong, or contradicts another doc, stop and say so.
  Propose the doc change first, implement second.
- Never commit secrets. API keys come from environment variables only.

## Commands

```
pnpm install
pnpm test
pnpm lint
pnpm build
pnpm --filter @contextforge/cli dev -- run --config user-repo/contextforge.yml
```
