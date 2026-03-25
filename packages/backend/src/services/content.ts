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
