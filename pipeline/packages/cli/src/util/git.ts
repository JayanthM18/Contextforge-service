/** The Git operations ContextForge needs, and nothing else. */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { baseEnv } from "./docker.js";
import { ContextForgeError } from "./errors.js";
import { type Exec, tail } from "./exec.js";

export class Git {
  constructor(
    private readonly exec: Exec,
    private readonly cwd: string,
    private readonly env: Record<string, string | undefined>,
  ) {}

  async run(args: readonly string[]): Promise<string> {
    const result = await this.exec("git", args, { cwd: this.cwd, env: baseEnv(this.env) });
    if (result.code !== 0) {
      throw new ContextForgeError("GIT_FAILED", `git ${args.join(" ")} failed`, {
        remedy: tail(result.stderr, 5) || "Run it yourself to see why.",
      });
    }
    return result.stdout.trim();
  }

  root(): Promise<string> {
    return this.run(["rev-parse", "--show-toplevel"]);
  }

  /** The full commit SHA a ref points at. */
  async resolve(ref: string): Promise<string> {
    try {
      return await this.run(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
    } catch (cause) {
      throw new ContextForgeError("GIT_FAILED", `"${ref}" is not a commit in this repository`, {
        cause,
        remedy: "Check the ref exists locally; in CI, fetch with fetch-depth: 0.",
      });
    }
  }

  async isDirty(): Promise<boolean> {
    return (await this.run(["status", "--porcelain", "--untracked-files=no"])) !== "";
  }

  async mergeBase(a: string, b: string): Promise<string> {
    return this.run(["merge-base", a, b]);
  }

  /** Commits reachable from `ref`, nearest first, at most `limit`. */
  async ancestors(ref: string, limit: number): Promise<string[]> {
    const out = await this.run(["rev-list", `--max-count=${String(limit)}`, ref]);
    return out === "" ? [] : out.split("\n");
  }

  /** A file's contents at a ref, or null when it does not exist there. */
  async show(ref: string, file: string): Promise<string | null> {
    const result = await this.exec("git", ["show", `${ref}:${file}`], {
      cwd: this.cwd,
      env: baseEnv(this.env),
    });
    return result.code === 0 ? result.stdout : null;
  }

  /**
   * A detached checkout of `sha` in a temporary directory, removed afterwards
   * whatever happens inside `use`.
   */
  async withWorktree<T>(sha: string, use: (dir: string) => Promise<T>): Promise<T> {
    const parent = await mkdtemp(path.join(tmpdir(), "contextforge-worktree-"));
    const dir = path.join(parent, "checkout");
    await this.run(["worktree", "add", "--detach", dir, sha]);
    try {
      return await use(dir);
    } finally {
      await this.exec("git", ["worktree", "remove", "--force", dir], {
        cwd: this.cwd,
        env: baseEnv(this.env),
      });
      await rm(parent, { recursive: true, force: true });
      await this.exec("git", ["worktree", "prune"], { cwd: this.cwd, env: baseEnv(this.env) });
    }
  }
}
