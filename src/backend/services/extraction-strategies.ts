import type { ExtractionStrategy } from "../../shared/types";

// Bounded for responsiveness: BGE-M3 inference on CPU scales steeply with input
// length (~9s at 8000 chars, ~2s at 1000), and embedding runs on the main thread,
// so a large body would block the HTTP server for seconds. Subject + first 1000
// chars captures the topic for search while keeping per-embed latency tolerable.
const BODY_MAX_CHARS = 1000;

export function buildEmbeddingText(
  email: { subject: string; bodyText: string },
  strategy: ExtractionStrategy
): string {
  const body = (email.bodyText ?? "").slice(0, BODY_MAX_CHARS);
  return strategy.template
    .replaceAll("{{subject}}", email.subject ?? "")
    .replaceAll("{{body_text}}", body);
}
