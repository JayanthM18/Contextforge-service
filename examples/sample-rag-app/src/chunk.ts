/**
 * Chunking is pure and deterministic: the same document and the same settings
 * always produce the same chunks with the same ids. The evaluator compares
 * retrieved context ids across runs, so an id that silently moves would show
 * up as a regression that never happened.
 */

import type { Chunk } from "./types.ts";

export interface ChunkOptions {
  readonly size: number;
  readonly overlap: number;
}

/**
 * Trailing text of `text`, at most `overlap` characters, cut at a word
 * boundary so a chunk never begins mid-word.
 */
export function overlapTail(text: string, overlap: number): string {
  if (overlap <= 0) return "";
  if (text.length <= overlap) return text;

  const tail = text.slice(-overlap);
  const boundary = tail.indexOf(" ");
  return boundary === -1 ? tail : tail.slice(boundary + 1);
}

/** Hard-split a single paragraph that exceeds `size` on its own. */
function splitLongParagraph(paragraph: string, options: ChunkOptions): string[] {
  const pieces: string[] = [];
  const stride = options.size - options.overlap;

  for (let start = 0; start < paragraph.length; start += stride) {
    pieces.push(paragraph.slice(start, start + options.size));
    if (start + options.size >= paragraph.length) break;
  }
  return pieces;
}

/**
 * Pack whole paragraphs into chunks of at most `size` characters, carrying
 * `overlap` characters of the previous chunk into the next one so a fact that
 * straddles a boundary is still retrievable.
 */
export function chunkDocument(docId: string, text: string, options: ChunkOptions): Chunk[] {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);

  const texts: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    if (paragraph.length > options.size) {
      if (current.length > 0) {
        texts.push(current);
        current = "";
      }
      texts.push(...splitLongParagraph(paragraph, options));
      continue;
    }

    const candidate = current.length === 0 ? paragraph : `${current}\n\n${paragraph}`;
    if (candidate.length <= options.size) {
      current = candidate;
      continue;
    }

    texts.push(current);
    const tail = overlapTail(current, options.overlap);
    const carried = tail.length === 0 ? paragraph : `${tail}\n\n${paragraph}`;
    current = carried.length <= options.size ? carried : paragraph;
  }

  if (current.length > 0) texts.push(current);

  return texts.map((chunkText, position) => ({
    id: `${docId}#c${String(position + 1)}`,
    docId,
    index: position + 1,
    text: chunkText.trim(),
  }));
}
