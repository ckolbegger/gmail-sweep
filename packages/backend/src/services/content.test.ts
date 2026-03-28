import { describe, it, expect } from 'vitest';
import { htmlToText, buildEmbeddingText, cosineSimilarity, extractBodyText } from './content.js';
import type { ExtractionStrategy } from '@gmail-sweep/shared';

describe('content extraction', () => {
  describe('htmlToText', () => {
    it('strips HTML tags from a simple email', () => {
      const html = '<p>Hello <strong>world</strong></p>';
      const result = htmlToText(html);
      expect(result).toContain('Hello world');
      expect(result).not.toContain('<p>');
    });

    it('handles a multi-paragraph email', () => {
      const html = '<p>First paragraph.</p><p>Second paragraph.</p>';
      const result = htmlToText(html);
      expect(result).toContain('First paragraph');
      expect(result).toContain('Second paragraph');
    });

    it('returns empty string for empty input', () => {
      expect(htmlToText('')).toBe('');
    });

    it('handles email with unsubscribe preamble links', () => {
      const html = '<div><p>Click here to <a href="#">unsubscribe</a></p><p>Your actual content</p></div>';
      const result = htmlToText(html);
      expect(result).toContain('Your actual content');
    });
  });

  describe('buildEmbeddingText', () => {
    const strategy: ExtractionStrategy = {
      type: 'template',
      template: 'Subject: {{subject}}\n\n{{body_text}}',
    };

    it('fills template with email fields', () => {
      const result = buildEmbeddingText(
        { subject: 'Meeting notes', bodyText: 'We discussed the Q2 plan.' },
        strategy
      );
      expect(result).toBe('Subject: Meeting notes\n\nWe discussed the Q2 plan.');
    });

    it('truncates body_text to 8000 chars', () => {
      const longBody = 'x'.repeat(10000);
      const result = buildEmbeddingText({ subject: 'Test', bodyText: longBody }, strategy);
      expect(result.length).toBeLessThanOrEqual(8020); // subject + template overhead
    });
  });

  describe('extractBodyText', () => {
    const CNN_STUB = [
      'It looks like your email client might not support HTML formatted email.',
      'Try opening this email in another email client.',
      'Or, open the following link to view this email in a browser:',
      'https://example.com/view',
    ].join('\n');

    it('returns plain text when present and not a stub', () => {
      expect(extractBodyText('Hello world', '<p>Hello world</p>')).toBe('Hello world');
    });

    it('falls back to HTML-converted text when plain text is absent', () => {
      expect(extractBodyText(null, '<p>Hello world</p>')).toBe('Hello world');
    });

    it('falls back to HTML-converted text when plain text is only whitespace', () => {
      expect(extractBodyText('   ', '<p>Hello world</p>')).toBe('Hello world');
    });

    it('returns empty string when both are absent', () => {
      expect(extractBodyText(null, null)).toBe('');
    });

    it('uses HTML when plain text contains "not support html"', () => {
      expect(extractBodyText('Your client does not support HTML email.', '<p>Real content</p>')).toBe('Real content');
    });

    it('uses HTML when plain text contains "html formatted email"', () => {
      expect(extractBodyText('email client might not support HTML formatted email.', '<p>Real content</p>')).toBe('Real content');
    });

    it("uses HTML when plain text contains \"doesn't support html\"", () => {
      expect(extractBodyText("Your client doesn't support HTML.", '<p>Real content</p>')).toBe('Real content');
    });

    it('uses HTML when plain text contains "in another email client"', () => {
      expect(extractBodyText('Try opening this email in another email client.', '<p>Real content</p>')).toBe('Real content');
    });

    it('uses HTML when plain text says "Plain text version not available"', () => {
      expect(extractBodyText('Plain text version not available.', '<p>Real content</p>')).toBe('Real content');
    });

    it('uses HTML for the CNN stub pattern', () => {
      expect(extractBodyText(CNN_STUB, '<p>Five good things.</p>')).toBe('Five good things.');
    });

    it('returns stub as last resort when no HTML is available', () => {
      expect(extractBodyText(CNN_STUB, null)).toBe(CNN_STUB.trim());
    });

    it('stub detection is case-insensitive', () => {
      expect(extractBodyText('NOT SUPPORT HTML FORMATTED EMAIL', '<p>Real content</p>')).toBe('Real content');
    });
  });

  describe('cosineSimilarity', () => {
    it('returns 1 for identical vectors', () => {
      expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
    });

    it('returns 0 for orthogonal vectors', () => {
      expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
    });

    it('returns 0 for a zero vector', () => {
      expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
    });

    it('returns 0 for empty vectors', () => {
      expect(cosineSimilarity([], [])).toBe(0);
    });
  });
});
