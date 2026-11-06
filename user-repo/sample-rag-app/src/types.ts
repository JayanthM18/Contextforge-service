/** One retrievable piece of a source document. */
export interface Chunk {
  /** Stable identifier, `<file>#c<n>`, as required by the app contract. */
  readonly id: string;
  /** Source file name, e.g. `returns-and-refunds.md`. */
  readonly docId: string;
  /** 1-based position of this chunk within its document. */
  readonly index: number;
  readonly text: string;
}

export interface ScoredChunk {
  readonly chunk: Chunk;
  readonly score: number;
}

/** A chunk with its embedding. The whole index is held in memory. */
export interface IndexedChunk {
  readonly chunk: Chunk;
  readonly vector: readonly number[];
}

/** `contexts[]` entry of the `/query` response in `docs/DESIGN.md` section 1. */
export interface ResponseContext {
  readonly text: string;
  readonly id: string;
  readonly score: number;
}

export interface TokenUsage {
  readonly prompt: number;
  readonly completion: number;
}

/** The `/query` response body. Shape is fixed by the app contract. */
export interface QueryResponse {
  readonly answer: string;
  readonly contexts: readonly ResponseContext[];
  readonly metadata: {
    readonly latency_ms: number;
    readonly tokens?: TokenUsage;
  };
}
