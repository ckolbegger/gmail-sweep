import { describe, it, expect } from 'vitest';
import { parseOperatorQuery } from './search-parser.js';

describe('parseOperatorQuery', () => {
  it('extracts from: and subject:', () => {
    const q = parseOperatorQuery('from:alice subject:invoice please pay');
    expect(q.operators).toEqual({ from: 'alice', subject: 'invoice' });
    expect(q.freeText).toBe('please pay');
  });

  it('returns empty operators for free-text-only', () => {
    const q = parseOperatorQuery('quarterly report');
    expect(q.operators).toEqual({});
    expect(q.freeText).toBe('quarterly report');
  });

  it('parses is: and has:', () => {
    const q = parseOperatorQuery('is:unread has:actions');
    expect(q.operators).toEqual({ is: 'unread', has: 'actions' });
  });

  it('parses before: and after: as ISO dates', () => {
    const q = parseOperatorQuery('before:2025-01-01 after:2024-06-01');
    expect(q.operators).toEqual({ before: '2025-01-01', after: '2024-06-01' });
  });
});
