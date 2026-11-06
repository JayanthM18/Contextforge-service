/**
 * Talking to the evaluator container: build the image if needed, write the
 * request to a mounted directory, run the container, parse the response.
 *
 * Nothing here knows how a score is computed; that is the evaluator's job.
 */

import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { z } from "zod";

import type { Config } from "../config/schema.js";
import { hashData, sha256 } from "../dataset/hash.js";
import { baseEnv } from "../util/docker.js";
import { ContextForgeError } from "../util/errors.js";
import { type Exec, tail } from "../util/exec.js";
import type { Logger } from "../util/logger.js";
import { TOOL_VERSION } from "../util/version.js";
import {
  type ScoreRequest,
  type ScoreRequestCase,
  type ScoreResponse,
  scoreResponseSchema,
} from "./types.js";

/** The evaluator sources, relative to this file in both `src/` and `dist/`. */
export const EVALUATOR_DIR = fileURLToPath(new URL("../../../../evaluator/", import.meta.url));

export interface EvaluatorOptions {
  readonly exec: Exec;
  readonly logger: Logger;
  readonly env: Record<string, string | undefined>;
  /** Defaults to `process.platform`; injected so both branches are testable. */
  readonly platform?: NodeJS.Platform;
  /** Defaults to the current user, so the container can write the response. */
  readonly user?: string | null;
}

/**
 * A hash of exactly the files baked into the image: the Dockerfile, the pinned
 * requirements and the Python app. Tests and docs are excluded, so editing
 * them does not force a rebuild.
 */
export async function evaluatorSourceHash(dir: string = EVALUATOR_DIR): Promise<string> {
  const app = (await readdir(path.join(dir, "app"), { recursive: true }))
    .filter((file) => file.endsWith(".py"))
    .map((file) => `app/${file.split(path.sep).join("/")}`);
  const files = ["Dockerfile", "requirements.txt", ...app].sort();

  const entries: [string, string][] = [];
  for (const file of files) entries.push([file, sha256(await readFile(path.join(dir, file)))]);
  return hashData(entries).slice("sha256:".length, "sha256:".length + 12);
}

/**
 * The image to use. The tag carries a hash of the evaluator's sources, not
 * only the tool version: with a version-only tag, changing the evaluator's
 * code silently reused the old image until someone rebuilt it by hand.
 */
export function evaluatorImage(
  env: Record<string, string | undefined>,
  sourceHash: string,
): string {
  const override = env.CONTEXTFORGE_EVALUATOR_IMAGE;
  return override !== undefined && override !== ""
    ? override
    : `contextforge-evaluator:${TOOL_VERSION}-${sourceHash}`;
}

/** Build the evaluator image unless it already exists or one was supplied. */
export async function ensureEvaluatorImage(options: EvaluatorOptions): Promise<string> {
  if (options.env.CONTEXTFORGE_EVALUATOR_IMAGE) return evaluatorImage(options.env, "");

  const image = evaluatorImage(options.env, await evaluatorSourceHash());
  const env = baseEnv(options.env);

  const inspect = await options.exec("docker", ["image", "inspect", image], { env });
  if (inspect.code === 0) return image;

  options.logger.info("building the evaluator image; the first build takes a few minutes", {
    image,
  });
  const build = await options.exec(
    "docker",
    ["build", "--target", "runtime", "--tag", image, EVALUATOR_DIR],
    {
      env,
      onStderrLine: (line) => {
        options.logger.debug(line);
      },
    },
  );
  if (build.code !== 0) {
    throw new ContextForgeError("EVALUATOR_FAILED", `Building ${image} failed`, {
      remedy: `Docker said:\n${tail(build.stderr)}`,
    });
  }
  return image;
}

/** The request for a set of answered cases, shaped by the config. Pure. */
export function buildScoreRequest(
  config: Config,
  cases: readonly ScoreRequestCase[],
): ScoreRequest {
  const { judge, embeddings, metrics, concurrency } = config.evaluation;
  return {
    task: "score",
    metrics: [...metrics],
    judge: {
      provider: judge.provider,
      model: judge.model,
      base_url: judge.base_url,
      api_key_env: judge.api_key_env,
      temperature: judge.temperature,
      seed: judge.seed,
      reasoning_effort: judge.reasoning_effort,
    },
    embeddings:
      embeddings === undefined
        ? null
        : {
            provider: embeddings.provider,
            model: embeddings.model,
            base_url: embeddings.base_url,
            api_key_env: embeddings.api_key_env,
          },
    concurrency,
    cases: [...cases],
  };
}

interface HasEndpoints {
  readonly judge: { readonly api_key_env: string | null };
  readonly embeddings: { readonly api_key_env: string | null } | null;
}

/** The key variables a request needs inside the container, and only those. */
export function keyVariables(request: HasEndpoints): string[] {
  const names = [request.judge.api_key_env, request.embeddings?.api_key_env].filter(
    (name): name is string => typeof name === "string" && name !== "",
  );
  return [...new Set(names)];
}

export interface DockerRunArgs {
  readonly task: "score" | "generate";
  readonly image: string;
  readonly workdir: string;
  readonly keyVariables: readonly string[];
  readonly platform: NodeJS.Platform;
  readonly user: string | null;
}

/** The `docker run` arguments for one scoring call. Pure. */
export function evaluatorRunArgs(args: DockerRunArgs): string[] {
  // On Linux, host networking means a judge reachable from the host —
  // localhost, a LAN address, a Tailscale address — is reachable unchanged.
  // Elsewhere host networking is not dependable, so map host.docker.internal.
  const network =
    args.platform === "linux"
      ? ["--network", "host"]
      : ["--add-host", "host.docker.internal:host-gateway"];

  return [
    "run",
    "--rm",
    ...network,
    ...(args.user === null ? [] : ["--user", args.user]),
    // The container user has no home directory; libraries that cache to
    // $HOME need somewhere writable.
    "--env",
    "HOME=/tmp",
    // `--env NAME` with no value copies NAME from our environment, so the key
    // itself never appears on a command line or in a process listing.
    ...args.keyVariables.flatMap((name) => ["--env", name]),
    "--volume",
    `${args.workdir}:/work`,
    args.image,
    args.task,
    "--input",
    "/work/request.json",
    "--output",
    "/work/response.json",
  ];
}

function currentUser(): string | null {
  return typeof process.getuid === "function" && typeof process.getgid === "function"
    ? `${String(process.getuid())}:${String(process.getgid())}`
    : null;
}

/** Check the response answers exactly the request, in order, for every metric. */
export function checkResponse(request: ScoreRequest, response: ScoreResponse): void {
  const expected = request.cases.map((c) => c.case_id);
  const actual = response.results.map((r) => r.case_id);
  if (expected.join("\n") !== actual.join("\n")) {
    throw new ContextForgeError(
      "EVALUATOR_FAILED",
      `The evaluator returned cases [${actual.join(", ")}] for a request of [${expected.join(", ")}]`,
      {
        remedy:
          "This is a bug in the evaluator or a version mismatch; rebuild the evaluator image.",
      },
    );
  }
  for (const result of response.results) {
    const missing = request.metrics.filter((metric) => !(metric in result.scores));
    if (missing.length > 0) {
      throw new ContextForgeError(
        "EVALUATOR_FAILED",
        `The evaluator returned no ${missing.join(", ")} score for ${result.case_id}`,
        { remedy: "Every requested metric must be present, as a number or null." },
      );
    }
  }
}

/**
 * Run one evaluator task: write the request, run the container, parse the
 * response against `schema`. Shared by scoring and generation.
 */
export async function runEvaluatorTask<T>(
  image: string,
  task: "score" | "generate",
  request: HasEndpoints,
  schema: z.ZodType<T>,
  options: EvaluatorOptions,
): Promise<T> {
  const keys = keyVariables(request);
  for (const name of keys) {
    if (!options.env[name]) {
      throw new ContextForgeError("CONFIG_INVALID", `${name} is not set`, {
        remedy: `The judge configuration names ${name} as its key variable. Export it, or set api_key_env to null.`,
      });
    }
  }

  const workdir = await mkdtemp(path.join(tmpdir(), "contextforge-eval-"));
  try {
    await writeFile(path.join(workdir, "request.json"), JSON.stringify(request));

    const result = await options.exec(
      "docker",
      evaluatorRunArgs({
        task,
        image,
        workdir,
        keyVariables: keys,
        platform: options.platform ?? process.platform,
        user: options.user === undefined ? currentUser() : options.user,
      }),
      {
        env: baseEnv(options.env, keys),
        onStderrLine: (line) => {
          options.logger.info(line.replace(/^(INFO|WARNING) /, ""), { from: "evaluator" });
        },
      },
    );

    if (result.code !== 0) {
      throw new ContextForgeError(
        "EVALUATOR_FAILED",
        `The evaluator exited with ${String(result.code)}`,
        {
          remedy: `Its last output was:\n${tail(result.stderr)}`,
        },
      );
    }

    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(path.join(workdir, "response.json"), "utf8"));
    } catch (cause) {
      throw new ContextForgeError("EVALUATOR_FAILED", "The evaluator wrote no readable response", {
        cause,
        remedy: `Its last output was:\n${tail(result.stderr)}`,
      });
    }

    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      throw new ContextForgeError(
        "EVALUATOR_FAILED",
        "The evaluator's response breaks the contract",
        {
          remedy: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n"),
        },
      );
    }
    return parsed.data;
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
}

export async function scoreCases(
  image: string,
  request: ScoreRequest,
  options: EvaluatorOptions,
): Promise<ScoreResponse> {
  if (request.cases.length === 0) {
    return {
      evaluator: { ragas_version: "n/a", judge_model: request.judge.model, embeddings_model: null },
      results: [],
    };
  }

  const response = await runEvaluatorTask(image, "score", request, scoreResponseSchema, options);
  checkResponse(request, response);
  return response;
}
