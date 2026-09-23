/**
 * GitHub Action wrapper: maps Action inputs to CLI flags and sets the check
 * status. Deliberately empty until stage 8 — see `docs/TASKS.md`.
 *
 * `docs/ARCHITECTURE.md` keeps this layer thin on purpose: the core knows
 * nothing about GitHub, which is what makes another CI system a wrapper swap
 * rather than a rewrite. The package exists now so the workspace, build graph
 * and CI cover it from the start.
 */

export { EXIT_CODE } from "@contextforge/shared";
