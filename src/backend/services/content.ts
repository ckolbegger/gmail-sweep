// src/backend/services/content.ts
import { convert } from "html-to-text";

export function htmlToText(html: string): string {
  if (!html) return "";
  return convert(html, {
    wordwrap: false,
    selectors: [
      { selector: "a", options: { ignoreHref: true } },
      { selector: "img", format: "skip" },
    ],
  }).trim();
}

const STUB_PATTERNS = [
  "not support html",
  "doesn't support html",
  "html formatted email",
  "in another email client",
  "plain text version not available",
];

export function isHtmlFallbackStub(text: string): boolean {
  const lower = text.toLowerCase();
  return STUB_PATTERNS.some((p) => lower.includes(p));
}

export function extractBodyText(plainText: string | null | undefined, htmlBody: string | null | undefined): string {
  const plain = plainText?.trim();
  if (plain && !isHtmlFallbackStub(plain)) return plain;
  if (htmlBody) return htmlToText(htmlBody);
  if (plain) return plain;
  return "";
}
