/**
 * One Compose project per app under test. Each gets a unique project name, so
 * teardown removes exactly what this run started and nothing a developer
 * already had running.
 */

import { randomBytes } from "node:crypto";

import { baseEnv } from "../util/docker.js";
import { ContextForgeError } from "../util/errors.js";
import { type Exec, tail } from "../util/exec.js";
import type { Logger } from "../util/logger.js";

export interface ComposeOptions {
  readonly exec: Exec;
  readonly logger: Logger;
  readonly composeFile: string;
  readonly service: string;
  /** Where the build runs from: the compose file's directory in that checkout. */
  readonly cwd: string;
  /** The full environment Compose sees: base Docker variables plus the passthrough list. */
  readonly env: Record<string, string>;
  readonly projectName: string;
}

/** A Compose project name: lowercase, starts with a letter, unique per run. */
export function projectName(
  role: string,
  random: () => string = () => randomBytes(4).toString("hex"),
): string {
  return `contextforge-${role.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${random()}`;
}

/** The environment for Compose: Docker's own variables plus `env_passthrough`, nothing else. */
export function composeEnv(
  source: Record<string, string | undefined>,
  passthrough: readonly string[],
): Record<string, string> {
  return baseEnv(source, passthrough);
}

export class ComposeProject {
  constructor(private readonly options: ComposeOptions) {}

  private base(): string[] {
    return [
      "compose",
      "--project-name",
      this.options.projectName,
      "--file",
      this.options.composeFile,
    ];
  }

  private run(args: readonly string[], timeoutMs?: number) {
    return this.options.exec("docker", [...this.base(), ...args], {
      cwd: this.options.cwd,
      env: this.options.env,
      onStderrLine: (line) => {
        this.options.logger.debug(line, { project: this.options.projectName });
      },
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    });
  }

  async up(): Promise<void> {
    const result = await this.run(["up", "--detach", "--build", this.options.service]);
    if (result.code !== 0) {
      throw new ContextForgeError(
        "APP_FAILED",
        `Building or starting ${this.options.service} failed`,
        {
          remedy: `docker compose said:\n${tail(result.stderr)}`,
        },
      );
    }
  }

  /** True while the service container is running. */
  async isRunning(): Promise<boolean> {
    const result = await this.run(
      ["ps", "--status", "running", "--quiet", this.options.service],
      15_000,
    );
    return result.code === 0 && result.stdout.trim() !== "";
  }

  async logs(lines = 40): Promise<string> {
    const result = await this.run(
      ["logs", "--no-color", "--tail", String(lines), this.options.service],
      15_000,
    );
    return result.stdout.trim() || result.stderr.trim();
  }

  /** Remove containers, networks and volumes. Never throws: it runs in `finally`. */
  async down(): Promise<void> {
    const result = await this.run(
      ["down", "--volumes", "--remove-orphans", "--timeout", "10"],
      120_000,
    );
    if (result.code !== 0) {
      this.options.logger.error("teardown failed; containers may be left behind", {
        project: this.options.projectName,
        hint: `docker compose --project-name ${this.options.projectName} down --volumes`,
        detail: tail(result.stderr, 3),
      });
    }
  }
}
