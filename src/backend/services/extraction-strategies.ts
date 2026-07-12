import type { ExtractionStrategy } from "../../shared/types";
import { chunkEmail } from "./chunker";

/**
 * Single embedding text for an email (the first chunk). Thin wrapper over
 * chunkEmail so the {{subject}}/{{body_text}} templating stays single-sourced;
 * the embedding worker calls chunkEmail directly to produce one vector per chunk
 * (see chunker.ts). Body length is bounded to CHUNK_MAX_CHARS there.
 */
export function buildEmbeddingText(
  email: { subject: string; bodyText: string },
  strategy: ExtractionStrategy
): string {
  return chunkEmail(email, strategy)[0];
}
