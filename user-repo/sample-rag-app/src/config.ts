/**
 * Configuration comes from the environment, never from a file baked into the
 * image. Every failure names the variable at fault, because a container that
 * exits with "invalid input" tells an operator nothing.
 */

export type Provider = "openai" | "gemini" | "local";

const REASONING_EFFORTS = ["none", "minimal", "low", "medium", "high"] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export interface AppConfig {
  readonly port: number;
  readonly knowledgeBaseDir: string;
  readonly chunkSize: number;
  readonly chunkOverlap: number;
  readonly topK: number;
  readonly provider: Provider;
  readonly embeddingModel: string;
  readonly generationModel: string;
  readonly apiKey: string;
  readonly apiBaseUrl: string;
  readonly geminiEmbeddingBaseUrl: string;
  readonly requestTimeoutMs: number;
  /** Sent to the model only when set; `none` stops reasoning models thinking first. */
  readonly reasoningEffort: ReasoningEffort | null;
}

export class ConfigError extends Error {
  override readonly name = "ConfigError";
}

type Env = Record<string, string | undefined>;

function integer(env: Env, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;

  const value = Number(raw);
  if (!Number.isInteger(value)) {
    throw new ConfigError(`${name} must be a whole number, got "${raw}"`);
  }
  if (value < min || value > max) {
    throw new ConfigError(
      `${name} must be between ${String(min)} and ${String(max)}, got ${String(value)}`,
    );
  }
  return value;
}

function text(env: Env, name: string, fallback: string): string {
  const raw = env[name];
  return raw === undefined || raw === "" ? fallback : raw;
}

function reasoningEffort(env: Env): ReasoningEffort | null {
  const raw = text(env, "REASONING_EFFORT", "");
  if (raw === "") return null;
  if (!(REASONING_EFFORTS as readonly string[]).includes(raw)) {
    throw new ConfigError(
      `REASONING_EFFORT must be one of ${REASONING_EFFORTS.join(", ")}, got "${raw}"`,
    );
  }
  return raw as ReasoningEffort;
}

export function loadConfig(env: Env = process.env): AppConfig {
  const providerRaw = text(env, "PROVIDER", "openai");
  if (providerRaw !== "openai" && providerRaw !== "gemini" && providerRaw !== "local") {
    throw new ConfigError(`PROVIDER must be "openai", "gemini" or "local", got "${providerRaw}"`);
  }

  const chunkSize = integer(env, "CHUNK_SIZE", 900, 100, 8000);
  const chunkOverlap = integer(env, "CHUNK_OVERLAP", 150, 0, 4000);
  if (chunkOverlap >= chunkSize) {
    throw new ConfigError(
      `CHUNK_OVERLAP (${String(chunkOverlap)}) must be smaller than CHUNK_SIZE (${String(chunkSize)}), ` +
        `otherwise chunking cannot make progress`,
    );
  }

  const apiKeyEnv = providerRaw === "gemini" ? "GEMINI_API_KEY" : "OPENAI_API_KEY";
  const apiKey = text(env, apiKeyEnv, "");
  if (providerRaw !== "local" && apiKey === "") {
    throw new ConfigError(
      `${apiKeyEnv} is required when PROVIDER is "${providerRaw}". ` +
        "Set it in the environment, or set PROVIDER=local to run the offline provider.",
    );
  }

  return {
    port: integer(env, "PORT", 8000, 1, 65535),
    knowledgeBaseDir: text(env, "KNOWLEDGE_BASE_DIR", "docs/knowledge-base"),
    chunkSize,
    chunkOverlap,
    topK: integer(env, "TOP_K", 5, 1, 50),
    provider: providerRaw,
    embeddingModel: text(
      env,
      "EMBEDDING_MODEL",
      providerRaw === "gemini" ? "gemini-embedding-001" : "text-embedding-3-small",
    ),
    generationModel: text(
      env,
      "GENERATION_MODEL",
      providerRaw === "gemini" ? "gemini-2.5-flash" : "gpt-4o-mini",
    ),
    apiKey,
    apiBaseUrl: text(
      env,
      "OPENAI_BASE_URL",
      providerRaw === "gemini"
        ? "https://generativelanguage.googleapis.com/v1beta/openai"
        : "https://api.openai.com/v1",
    ),
    geminiEmbeddingBaseUrl: text(
      env,
      "GEMINI_EMBEDDING_BASE_URL",
      "https://generativelanguage.googleapis.com/v1beta",
    ),
    requestTimeoutMs: integer(env, "REQUEST_TIMEOUT_MS", 60_000, 1_000, 600_000),
    reasoningEffort: reasoningEffort(env),
  };
}
