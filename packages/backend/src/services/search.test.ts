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

  it('falls back to semantic search when an LLM-guessed subject filter matches nothing', async () => {
    // Real-world failure: for "order confirmations and shipping notifications"
    // the LLM sets filters.subject to the whole topic phrase. No subject
    // matches the phrase via LIKE, so SQL prefiltering returned 0 candidates
    // and search bailed out before the vector stage.
    db.upsertEmail(makeEmail('a', 'shop@amazon.com', 'Your package has shipped!', '2026-03-01T00:00:00Z', 'tracking number enclosed'));
    db.upsertEmail(makeEmail('b', 'bob@x.com', 'Meeting notes', '2026-03-02T00:00:00Z', 'agenda items'));
    db.upsertEmbedding('a', new Array(1024).fill(0.1));
    db.upsertEmbedding('b', new Array(1024).fill(-0.1));

    vi.mocked(mockAi.parseSearchQuery).mockResolvedValue({
      filters: { subject: 'order confirmations shipping notifications' },
      semanticQuery: 'order confirmations and shipping notifications',
    });

    const search = createSearchService(db, mockAi, mockEmbed);
    const result = await search.search({ query: 'order confirmations and shipping notifications', limit: 5 });

    expect(result.emails.length).toBeGreaterThan(0);
    expect(result.emails[0].id).toBe('a'); // closest vector wins
  });

  it('still returns empty when a hard filter (sender) matches nothing', async () => {
    db.upsertEmail(makeEmail('a', 'alice@x.com', 'Hello', '2026-03-01T00:00:00Z', 'hi'));
    db.upsertEmbedding('a', new Array(1024).fill(0.1));

    vi.mocked(mockAi.parseSearchQuery).mockResolvedValue({
      filters: { sender: 'nonexistent@nowhere.com' },
      semanticQuery: 'hello',
    });

    const search = createSearchService(db, mockAi, mockEmbed);
    const result = await search.search({ query: 'emails from nonexistent about hello', limit: 5 });

    expect(result.emails).toHaveLength(0);
  });

  it('searches all synced mail, not just INBOX', async () => {
    // Real-world failure: a CATEGORY_PROMOTIONS email without the INBOX label
    // was the best semantic match but never surfaced, because search reused
    // the inbox-view listing (hardcoded INBOX filter) for its candidates.
    const promo = makeEmail('p', 'hello@scylladb.com', 'Why DynamoDB workloads slow down', '2026-03-01T00:00:00Z', 'database performance webinar');
    promo.labels = ['CATEGORY_PROMOTIONS', 'UNREAD'];
    db.upsertEmail(promo);
    db.upsertEmbedding('p', new Array(1024).fill(0.1));

    vi.mocked(mockAi.parseSearchQuery).mockResolvedValue({
      filters: {},
      semanticQuery: 'database performance',
    });

    const search = createSearchService(db, mockAi, mockEmbed);
    const result = await search.search({ query: 'database performance', limit: 5 });

    expect(result.emails.map(e => e.id)).toContain('p');
  });

  it('surfaces the best semantic match even when it is older than the newest candidates', async () => {
    // Real-world failure: candidates were the newest N emails by date, then
    // intersected with KNN hits. The semantically closest email — if older
    // than that window — was silently dropped and search returned newest
    // emails with fake 1.0 scores.
    const near = new Array(1024).fill(0.1);   // ~identical to query vector
    const far = new Array(1024).fill(-0.1);   // opposite direction

    // limit=2 → candidate window of 20 newest emails; 'old' is number 25
    db.upsertEmail(makeEmail('old', 'archive@x.com', 'Kubernetes migration plan', '2026-01-01T00:00:00Z', 'cluster upgrade runbook'));
    db.upsertEmbedding('old', near);
    for (let i = 0; i < 24; i++) {
      const id = `new${i}`;
      db.upsertEmail(makeEmail(id, 'noise@x.com', `Newsletter ${i}`, `2026-03-${String(i + 1).padStart(2, '0')}T00:00:00Z`, 'unrelated chatter'));
      db.upsertEmbedding(id, far);
    }

    vi.mocked(mockAi.parseSearchQuery).mockResolvedValue({
      filters: {},
      semanticQuery: 'kubernetes cluster upgrade',
    });

    const search = createSearchService(db, mockAi, mockEmbed);
    const result = await search.search({ query: 'kubernetes cluster upgrade', limit: 2 });

    expect(result.emails[0]?.id).toBe('old');
    expect(result.scores[0]).toBeGreaterThan(0.9);
  });

  it('falls back to pure semantic search when the LLM query parser fails', async () => {
    // The LLM proxy can be busy (e.g. summarizer churning through a backlog)
    // or down. Search should degrade to treating the whole query as the
    // semantic query instead of failing the request.
    db.upsertEmail(makeEmail('a', 'billing@x.com', 'Your bill is due', '2026-03-01T00:00:00Z', 'pay your invoice'));
    db.upsertEmbedding('a', new Array(1024).fill(0.1));

    vi.mocked(mockAi.parseSearchQuery).mockRejectedValue(new Error('LLM timeout'));

    const search = createSearchService(db, mockAi, mockEmbed);
    const result = await search.search({ query: 'bills that are due', limit: 5 });

    expect(result.emails.map(e => e.id)).toContain('a');
  });

  it('gives up on a hanging LLM parser after the parse timeout', async () => {
    db.upsertEmail(makeEmail('a', 'billing@x.com', 'Your bill is due', '2026-03-01T00:00:00Z', 'pay your invoice'));
    db.upsertEmbedding('a', new Array(1024).fill(0.1));

    vi.mocked(mockAi.parseSearchQuery).mockReturnValue(new Promise(() => {})); // never resolves

    const search = createSearchService(db, mockAi, mockEmbed, { parseTimeoutMs: 50 });
    const result = await search.search({ query: 'bills that are due', limit: 5 });

    expect(result.emails.map(e => e.id)).toContain('a');
  });

  it('returns scores for each result', async () => {
    db.upsertEmail(makeEmail('a', 'a@b.com', 'Test', '2026-03-01T00:00:00Z', 'test'));

    vi.mocked(mockAi.parseSearchQuery).mockResolvedValue({ filters: {}, semanticQuery: 'test' });

    const search = createSearchService(db, mockAi, mockEmbed);
    const result = await search.search({ query: 'test', limit: 10 });

    expect(result.scores).toHaveLength(result.emails.length);
  });
});
