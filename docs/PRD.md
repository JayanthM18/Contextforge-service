# Product requirements

## Overview

ContextForge is a developer tool that turns RAG evaluation into a repeatable
regression test that runs in CI. It generates a fixed evaluation set from a
team's own documents, runs it against a pull request, compares the results to a
stored baseline from `main`, and reports pass or fail on the PR before the
change is merged.

It is delivered as a CLI plus Docker images, wrapped in a custom GitHub Action
so a team adds it to an existing workflow in a few lines.

## Problem statement

A RAG application depends on several interacting parts: chunking, embeddings,
retrieval, reranking, prompts and generation. Changing any one of them can make
answers measurably worse while the application still starts, serves traffic and
passes every unit test. Nothing raises an error, so the drop is invisible until
users complain.

Today, teams check quality by hand and by memory. There is no fixed test set
tied to their own documents, no reproducible way to compare two versions, and
no number a reviewer can look at on the pull request. Code review catches bad
code, not worse answers.

## Goals

1. Detect quality regressions in a RAG app before a pull request is merged.
2. Make the check reproducible: same questions, same judge settings, same
   environment, so a difference means a real change.
3. Report results where reviewers already look — on the pull request — with a
   pass/fail status that branch protection can enforce.
4. Show *which* test cases regressed and what the two versions retrieved and
   answered, so the result is actionable rather than just a red number.
5. Keep the cost of a check low enough that teams leave it switched on.

## Non-goals

- Improving RAG quality. ContextForge measures; it does not tune.
- Replacing human review or unit tests.
- A hosted dashboard, SaaS product, or model training of any kind.
- Integrations with CI systems other than GitHub Actions in the MVP. The core
  stays portable, but only the GitHub Action ships first.

## Target users

**Primary — the developer changing a RAG pipeline.** Wants to know whether the
chunk size or prompt change they just made helped or hurt, without hand-testing
twenty questions.

**Secondary — the reviewer.** Sees a diff that changes `top_k` from 5 to 3 and
has no way to judge its effect. Wants evidence on the PR.

**Secondary — the team lead.** Wants a quality floor that cannot be crossed by
accident, and a record of quality over time.

Assumed context: a small team, an existing GitHub repo with CI, a RAG app they
can run in Docker, and a willingness to expose a single query endpoint.

## Core MVP

The MVP is complete when a developer can add ContextForge to a repo and get a
verdict on a pull request.

Must have:

1. `contextforge.yml` config, validated with clear errors.
2. Test-set generation from the team's documents using Ragas, reviewed by a
   human and committed to the repo (frozen, not regenerated per run).
3. Running a RAG app in Docker through a documented query contract.
4. Scoring with four Ragas metrics: context precision, context recall,
   faithfulness, answer relevancy.
5. Baseline comparison: stored benchmark for the merge base, with a
   dual-environment fallback when no usable benchmark exists.
6. Configurable thresholds — a maximum allowed drop per metric, an absolute
   floor, and a maximum number of regressed cases.
7. A GitHub Action that posts a PR comment and sets a pass/fail check.

Explicitly deferred past the MVP: trend dashboards, cost and latency budgets,
local-model judges, retrieval-only fast mode, adapters for frameworks, and
support for non-GitHub CI.

## Success criteria

- On a set of pull requests with deliberately introduced regressions, the tool
  flags every one of them and passes a harmless refactor.
- Cached mode returns the same verdict as dual mode on the same pull requests.
- A first-time user can go from an empty config to a verdict on a PR by
  following the README, without reading the source.
