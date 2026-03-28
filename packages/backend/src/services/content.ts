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

function isHtmlFallbackStub(text: string): boolean {
  const lower = text.toLowerCase();
  return lower.includes('not support html')
    || lower.includes("doesn't support html")
    || lower.includes('html formatted email')
    || lower.includes('in another email client');
}

/**
 * Given an email that may have HTML or plain text, returns the canonical
 * body_text to store. Preference: text/plain > HTML-converted.
 * Falls back to HTML conversion when plain text is a "no HTML support" stub.
 */
export function extractBodyText(plainText: string | null, htmlBody: string | null): string {
  const plain = plainText?.trim();
  if (plain && !isHtmlFallbackStub(plain)) return plain;
  if (htmlBody) return htmlToText(htmlBody);
  if (plain) return plain;
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
