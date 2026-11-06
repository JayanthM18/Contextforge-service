/** Docker helpers shared by the runner and the evaluator client. */

import { ContextForgeError } from "./errors.js";
import { type Exec, tail } from "./exec.js";

/**
 * The environment Docker and Git are run with: enough to find the daemon and
 * the user's credentials, and nothing else. Anything the app should see is
 * added explicitly, so a stray variable in a developer's shell can never
 * change a result.
 */
const PASS_THROUGH = [
  "PATH",
  "HOME",
  "USER",
  "LANG",
  "TMPDIR",
  "XDG_RUNTIME_DIR",
  "DOCKER_HOST",
  "DOCKER_CONFIG",
  "DOCKER_CONTEXT",
  "DOCKER_CERT_PATH",
  "DOCKER_TLS_VERIFY",
  "SSH_AUTH_SOCK",
] as const;

export function baseEnv(
  source: Record<string, string | undefined>,
  extra: readonly string[] = [],
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of [...PASS_THROUGH, ...extra]) {
    const value = source[name];
    if (value !== undefined) env[name] = value;
  }
  return env;
}

export async function assertDockerAvailable(
  run: Exec,
  env: Record<string, string | undefined>,
): Promise<void> {
  const result = await run("docker", ["info", "--format", "{{.ServerVersion}}"], {
    env: baseEnv(env),
    timeoutMs: 20_000,
  });
  if (result.code !== 0) {
    throw new ContextForgeError("DOCKER_UNAVAILABLE", "The Docker daemon is not reachable", {
      remedy:
        "Start Docker (on Linux: `sudo systemctl start docker`) and check `docker info` works. " +
        `Docker said: ${tail(result.stderr, 3)}`,
    });
  }

  // Compose v2 is a separate plugin that system updates can remove on their
  // own. Without this check its absence surfaces as "unknown flag:
  // --project-name", which points nowhere near the cause.
  const compose = await run("docker", ["compose", "version"], {
    env: baseEnv(env),
    timeoutMs: 20_000,
  });
  if (compose.code !== 0) {
    throw new ContextForgeError(
      "DOCKER_UNAVAILABLE",
      "The Docker Compose plugin is not installed",
      {
        remedy:
          "Install Compose v2 so `docker compose version` works: `sudo pacman -S docker-compose` on Arch, " +
          "the docker-compose-plugin package on Debian, Ubuntu or Fedora, or Docker Desktop elsewhere.",
      },
    );
  }
}
