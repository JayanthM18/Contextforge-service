# Product requirements

## Overview

ContextForge is a hosted PaaS that runs repeatable RAG evaluations for
connected GitHub repositories. A user installs the ContextForge GitHub App on
a repository. When code is pushed or a pull request is opened or updated,
ContextForge receives the GitHub event, checks out the user's commit, runs
their RAG application and its dependencies in an isolated environment, and
reports the evaluation back to that repository.

The user repository owns the RAG code, vector database, Compose stack, frozen
evaluation set, and ContextForge configuration. Users do not add a
ContextForge GitHub Actions workflow. ContextForge may retain a CLI and
containerized evaluator as implementation components, but the product
integration is the hosted service and GitHub App.

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
6. Require no ContextForge workflow code in a user's repository.

## Non-goals

- Improving RAG quality. ContextForge measures; it does not tune.
- Replacing human review or unit tests.
- Model training of any kind.
- Modifying or owning the user's RAG application, vector database, or cloud
  infrastructure. ContextForge runs the user's supplied Compose stack for an
  evaluation; it does not become the application's runtime.

## Target users

**Primary — the developer changing a RAG pipeline.** Wants to know whether the
chunk size or prompt change they just made helped or hurt, without hand-testing
twenty questions.

**Secondary — the reviewer.** Sees a diff that changes `top_k` from 5 to 3 and
has no way to judge its effect. Wants evidence on the PR.

**Secondary — the team lead.** Wants a quality floor that cannot be crossed by
accident, and a record of quality over time.

Assumed context: a small team, a GitHub repository, a RAG app and its
dependencies runnable through Docker Compose, a frozen evaluation set, and a
query endpoint compatible with the ContextForge app contract.

## Core MVP

The MVP is complete when a developer can install the ContextForge GitHub App
on a repository, configure their RAG evaluation inputs, and get an automated
verdict on a pull request without adding a CI workflow file.

Must have:

1. `contextforge.yml` config, validated with clear errors.
2. Test-set generation from the team's documents using Ragas, reviewed by a
   human and committed to the repo (frozen, not regenerated per run).
3. Running a RAG app in Docker through a documented query contract.
4. Scoring with four Ragas metrics: context precision, context recall,
   faithfulness, answer relevancy.
5. Baseline comparison: reuse the stored benchmark for the merge base only
   when its fingerprint matches; otherwise rebuild and score the merge-base
   app.
6. Configurable thresholds — a maximum allowed drop per metric, an absolute
   floor, and a maximum number of regressed cases.
7. A hosted GitHub App service that receives repository events and publishes
   a pass/fail check and report on the originating pull request.
8. Isolated execution for user-controlled source and Compose configuration,
   with explicit credential handling and cleanup after each run.

Explicitly deferred past the MVP: trend dashboards, cost and latency budgets,
local-model judges, retrieval-only fast mode, adapters for frameworks,
support for non-GitHub source hosts, and a managed runtime for user
applications.

## Success criteria

- On a set of pull requests with deliberately introduced regressions, the tool
  flags every one of them and passes a harmless refactor.
- A matching stored benchmark is reused; missing or incompatible benchmarks
  trigger a merge-base rebuild and still produce a verdict.
- A first-time user can go from an empty config to a verdict on a PR by
  installing the GitHub App and following the README, without adding a
  workflow or reading the source.
