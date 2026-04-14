import type { ExtractionStrategy } from "../../shared/types";

const BODY_MAX_CHARS = 8000;

export function buildEmbeddingText(
  email: { subject: string; bodyText: string },
  strategy: ExtractionStrategy
): string {
  const body = (email.bodyText ?? "").slice(0, BODY_MAX_CHARS);
  return strategy.template
    .replaceAll("{{subject}}", email.subject ?? "")
    .replaceAll("{{body_text}}", body);
}
