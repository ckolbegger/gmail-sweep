import { describe, it, expect } from 'vitest';
import { htmlToText, buildEmbeddingText } from './content.js';
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
});
