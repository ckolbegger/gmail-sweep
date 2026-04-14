import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createDb, type DbHandle } from './db.js';
import { createSearchService } from './search.js';
import type { AiService } from './ai.js';
import type { EmbedService } from './embed.js';
import type { Email } from '@gmail-sweep/shared';

function makeEmail(id: string, sender: string, subject: string, date: string, bodyText = ''): Email {
  return { id, threadId: `t${id}`, subject, from: sender, date, snippet: '', bodyText,
    bodyHtml: null, labels: ['INBOX'], summary: null };
}

describe('search service', () => {
  let db: DbHandle;
  let mockAi: AiService;
  let mockEmbed: EmbedService;

  beforeEach(() => {
    db = createDb(':memory:');
    mockAi = {
      summarizeEmail: vi.fn(),
      parseSearchQuery: vi.fn(),
    };
    mockEmbed = {
      embedDocument: vi.fn(),
      embedQuery: vi.fn().mockResolvedValue(new Array(1024).fill(0.1)),
    };
  });

  it('returns emails matching SQL filters from parsed query', async () => {
    db.upsertEmail(makeEmail('a', 'sarah@work.com', 'Project update', '2026-03-20T00:00:00Z', 'deadline approaching'));
    db.upsertEmail(makeEmail('b', 'bob@work.com', 'Lunch plans', '2026-03-21T00:00:00Z', 'lets grab lunch'));

    vi.mocked(mockAi.parseSearchQuery).mockResolvedValue({
      filters: { sender: 'sarah' },
      semanticQuery: 'project deadline',
    });

    const search = createSearchService(db, mockAi, mockEmbed);
    const result = await search.search({ query: 'emails from sarah about project', limit: 10 });

    expect(result.emails).toHaveLength(1);
    expect(result.emails[0].id).toBe('a');
  });

  it('returns all emails when query has no filters', async () => {
    db.upsertEmail(makeEmail('a', 'alice@x.com', 'Alpha', '2026-03-01T00:00:00Z', 'alpha content'));
    db.upsertEmail(makeEmail('b', 'bob@x.com', 'Beta', '2026-03-02T00:00:00Z', 'beta content'));

    vi.mocked(mockAi.parseSearchQuery).mockResolvedValue({
      filters: {},
      semanticQuery: 'content',
    });

    const search = createSearchService(db, mockAi, mockEmbed);
    const result = await search.search({ query: 'content', limit: 10 });

    expect(result.emails).toHaveLength(2);
  });

  it('uses operator parser instead of LLM when operators present', async () => {
    db.upsertEmail(makeEmail('1', 'alice@example.com', 'invoice', '2026-03-01T00:00:00Z', 'pay now'));
    db.upsertEmail(makeEmail('2', 'bob@example.com', 'hello', '2026-03-02T00:00:00Z', 'hi there'));
    const aiMock = { parseSearchQuery: vi.fn(), summarizeEmail: vi.fn() };
    const search = createSearchService(db, aiMock as any, mockEmbed);
    const res = await search.search({ query: 'from:alice' });
    expect(aiMock.parseSearchQuery).not.toHaveBeenCalled();
    expect(res.emails.map(e => e.id)).toContain('1');
  });

  it('returns scores for each result', async () => {
    db.upsertEmail(makeEmail('a', 'a@b.com', 'Test', '2026-03-01T00:00:00Z', 'test'));

    vi.mocked(mockAi.parseSearchQuery).mockResolvedValue({ filters: {}, semanticQuery: 'test' });

    const search = createSearchService(db, mockAi, mockEmbed);
    const result = await search.search({ query: 'test', limit: 10 });

    expect(result.scores).toHaveLength(result.emails.length);
  });
});
