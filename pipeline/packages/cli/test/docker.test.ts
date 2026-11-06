import { describe, expect, it } from "vitest";

import { assertDockerAvailable, baseEnv } from "../src/util/docker.js";
import { failure, fakeExec } from "./helpers.js";

describe("assertDockerAvailable", () => {
  it("passes when the daemon and the Compose plugin both answer", async () => {
    const { exec, calls } = fakeExec();

    await assertDockerAvailable(exec, {});

    expect(calls.map((c) => c.args.join(" "))).toEqual([
      "info --format {{.ServerVersion}}",
      "compose version",
    ]);
  });

  it("says to start the daemon when it is not running", async () => {
    const { exec } = fakeExec(() => ({ code: 1, stderr: "Cannot connect to the Docker daemon" }));

    const error = await failure(assertDockerAvailable(exec, {}));

    expect(error.message).toBe("The Docker daemon is not reachable");
    expect(error.remedy).toContain("systemctl start docker");
  });

  it("says to install Compose when the plugin is missing, not 'unknown flag'", async () => {
    const { exec } = fakeExec((_c, args) =>
      args[0] === "compose"
        ? { code: 1, stderr: "docker: unknown command: docker compose" }
        : { code: 0 },
    );

    const error = await failure(assertDockerAvailable(exec, {}));

    expect(error.code).toBe("DOCKER_UNAVAILABLE");
    expect(error.message).toBe("The Docker Compose plugin is not installed");
    expect(error.remedy).toContain("docker compose version");
  });
});

describe("baseEnv", () => {
  it("keeps Docker's own variables and the requested extras, nothing else", () => {
    expect(
      baseEnv({ PATH: "/bin", DOCKER_HOST: "unix:///x", SECRET: "no", TOP_K: "3" }, ["TOP_K"]),
    ).toEqual({
      PATH: "/bin",
      DOCKER_HOST: "unix:///x",
      TOP_K: "3",
    });
  });
});
