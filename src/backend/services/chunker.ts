import type { ExtractionStrategy } from "../../shared/types";

// Per-chunk size cap on the BODY slice. BGE-M3 inference on CPU scales steeply
// with input length (~2s at 1000 chars), and the embedding worker yields per
// chunk, so this bounds the longest single block of main-thread work.
export const CHUNK_MAX_CHARS = 1000;

// Bounds pathological emails so one huge message can't monopolize the worker.
export const MAX_CHUNKS_PER_EMAIL = 20;

export interface ChunkableEmail {
  subject: string;
  bodyText: string;
}

function render(subject: string, bodySlice: string, strategy: ExtractionStrategy): string {
  return strategy.template
    .replaceAll("{{subject}}", subject)
    .replaceAll("{{body_text}}", bodySlice);
}

/**
 * Split an email into paragraph-coherent chunks and return one templated
 * embedding text per chunk (the subject is prefixed into every chunk).
 *
 * Pure + deterministic (no I/O, no async). The embedding worker embeds each
 * returned string separately so a long multi-topic email becomes searchable by
 * any of its topics instead of only its opening.
 *
 * - body <= CHUNK_MAX_CHARS -> single chunk (identical to legacy buildEmbeddingText)
 * - longer body -> greedy paragraph packing (paragraphs kept whole); an
 *   oversized paragraph is isolated and hard-truncated to the cap.
 * - always returns at least one chunk; capped at MAX_CHUNKS_PER_EMAIL.
 */
export function chunkEmail(email: ChunkableEmail, strategy: ExtractionStrategy): string[] {
  const subject = email.subject ?? "";
  const body = email.bodyText ?? "";
  const chunks: string[] = [];

  const push = (slice: string): void => {
    if (chunks.length >= MAX_CHUNKS_PER_EMAIL) return;
    chunks.push(render(subject, slice, strategy));
  };

  // Common case: short body is a single chunk.
  if (body.length <= CHUNK_MAX_CHARS) {
    push(body);
    return chunks;
  }

  // Greedy paragraph packing: accumulate paragraphs into a chunk until the next
  // would exceed the cap, keeping paragraphs whole. An oversized paragraph is
  // isolated and hard-truncated so one giant block can't blow past the limit.
  const paragraphs = body.split(/\n\s*\n/);
  let current = "";
  for (const para of paragraphs) {
    if (chunks.length >= MAX_CHUNKS_PER_EMAIL) break;
    const piece = para.trim();
    if (piece.length === 0) continue;

    if (piece.length > CHUNK_MAX_CHARS) {
      if (current) {
        push(current);
        current = "";
      }
      push(piece.slice(0, CHUNK_MAX_CHARS));
      continue;
    }

    const candidate = current ? `${current}\n\n${piece}` : piece;
    if (candidate.length <= CHUNK_MAX_CHARS) {
      current = candidate;
    } else {
      if (current) push(current);
      current = piece;
    }
  }
  if (current && chunks.length < MAX_CHUNKS_PER_EMAIL) push(current);

  // Degenerate input (e.g. a body of only newlines > cap) must still yield one
  // chunk so the worker doesn't retry the same email forever.
  if (chunks.length === 0) push(body.slice(0, CHUNK_MAX_CHARS));

  return chunks;
}
