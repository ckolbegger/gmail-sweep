import { convert } from 'html-to-text';
import type { ExtractionStrategy } from '@gmail-sweep/shared';

const BODY_MAX_CHARS = 8000;

export function htmlToText(html: string): string {
  if (!html) return '';
  return convert(html, {
    wordwrap: false,
    selectors: [
      { selector: 'a', options: { ignoreHref: true } },
      { selector: 'img', format: 'skip' },
    ],
  }).trim();
}

export function buildEmbeddingText(
  email: { subject: string; bodyText: string },
  strategy: ExtractionStrategy
): string {
  const truncatedBody = email.bodyText.slice(0, BODY_MAX_CHARS);

  return strategy.template
    .replace('{{subject}}', email.subject ?? '')
    .replace('{{body_text}}', truncatedBody);
}

/**
 * Given an email that may have HTML or plain text, returns the canonical
 * body_text to store. Preference: text/plain > HTML-converted.
 */
export function extractBodyText(plainText: string | null, htmlBody: string | null): string {
  if (plainText && plainText.trim()) return plainText.trim();
  if (htmlBody) return htmlToText(htmlBody);
  return '';
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * (b[i] ?? 0);
    normA += a[i]! ** 2;
    normB += (b[i] ?? 0) ** 2;
  }
  return normA === 0 || normB === 0 ? 0 : dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
