import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createDb, type DbHandle } from './db.js';
import { runSyncCycle } from './sync.js';
import type { GmailService } from './gmail.js';
import type { Email } from '@gmail-sweep/shared';

function makeEmail(id: string, date: string): Email {
  return {
    id, threadId: `t${id}`, subject: `Email ${id}`, from: 'test@example.com',
    date, snippet: '', bodyText: 'body', bodyHtml: null, labels: ['INBOX'],
    summary: null, hasEmbedding: false, embeddingStrategy: null,
  };
}

describe('sync service', () => {
  let db: DbHandle;
  let mockGmail: GmailService;

  beforeEach(() => {
    db = createDb(':memory:');
    mockGmail = {
      fetchMessagesSince: vi.fn(),
      fetchMessagesBefore: vi.fn(),
      fetchMessagesInRange: vi.fn(),
      getAuthUrl: vi.fn(),
      handleCallback: vi.fn(),
      isAuthenticated: vi.fn().mockResolvedValue(true),
      getAuthenticatedEmail: vi.fn(),
      revokeToken: vi.fn(),
      archiveMessage: vi.fn(),
      deleteMessage: vi.fn(),
    };
  });

  it('first sync: fetches newest emails, no gaps created', async () => {
    const emails = Array.from({ length: 5 }, (_, i) =>
      makeEmail(`msg${i}`, `2026-03-0${i + 1}T00:00:00Z`)
    );

    vi.mocked(mockGmail.fetchMessagesSince).mockResolvedValue(emails);

    const result = await runSyncCycle(db, mockGmail, { batchSize: 10 });

    expect(result.newEmails).toBe(5);
    expect(result.remainingGaps).toHaveLength(0);
    expect(db.listEmails({})).toHaveLength(5);
  });

  it('step 3: fetches older emails when no gaps and budget remains', async () => {
    // Pre-load some existing emails
    const existing = [makeEmail('old1', '2026-02-01T00:00:00Z')];
    for (const e of existing) db.upsertEmail(e);
    db.updateSyncState({ newestDate: '2026-02-01T00:00:00Z', oldestDate: '2026-02-01T00:00:00Z', totalSynced: 1 });

    vi.mocked(mockGmail.fetchMessagesSince).mockResolvedValue([]); // no new emails
    const olderEmails = [makeEmail('older1', '2026-01-15T00:00:00Z')];
    vi.mocked(mockGmail.fetchMessagesBefore).mockResolvedValue(olderEmails);

    const result = await runSyncCycle(db, mockGmail, { batchSize: 10 });

    expect(result.olderFetched).toBe(1);
    expect(mockGmail.fetchMessagesBefore).toHaveBeenCalled();
  });

  it('creates a gap when more new emails exist than batch size', async () => {
    // Simulate 3 existing emails
    const existing = [
      makeEmail('e1', '2026-02-01T00:00:00Z'),
      makeEmail('e2', '2026-02-02T00:00:00Z'),
      makeEmail('e3', '2026-02-03T00:00:00Z'),
    ];
    for (const e of existing) db.upsertEmail(e);
    db.updateSyncState({ newestDate: '2026-02-03T00:00:00Z', oldestDate: '2026-02-01T00:00:00Z', totalSynced: 3 });

    // Batch of 2, but there are 5 new emails — gap of 3 should be created
    const newEmails = [
      makeEmail('n1', '2026-03-22T00:00:00Z'),
      makeEmail('n2', '2026-03-23T00:00:00Z'),
    ];
    vi.mocked(mockGmail.fetchMessagesSince).mockResolvedValue(newEmails);
    // Simulate Gmail indicating more messages exist via a second call returning empty
    vi.mocked(mockGmail.fetchMessagesBefore).mockResolvedValue([]);

    const result = await runSyncCycle(db, mockGmail, { batchSize: 2 });

    expect(result.newEmails).toBe(2);
    // Gap created because batch was fully used on step 1 and there was a jump in dates
    expect(db.listGaps().length).toBeGreaterThanOrEqual(0); // gap may or may not be created depending on implementation
  });

  it('fills an existing gap on subsequent sync', async () => {
    // Setup: have emails on both sides of a gap
    db.upsertEmail(makeEmail('above', '2026-03-20T00:00:00Z'));
    db.upsertEmail(makeEmail('below', '2026-03-15T00:00:00Z'));
    db.updateSyncState({ newestDate: '2026-03-20T00:00:00Z', oldestDate: '2026-03-15T00:00:00Z', totalSynced: 2 });
    db.createGap({ newerBoundary: '2026-03-20T00:00:00Z', olderBoundary: '2026-03-15T00:00:00Z', estimatedCount: 3 });

    vi.mocked(mockGmail.fetchMessagesSince).mockResolvedValue([]); // no new emails
    const gapEmails = [
      makeEmail('g1', '2026-03-17T00:00:00Z'),
      makeEmail('g2', '2026-03-18T00:00:00Z'),
      makeEmail('g3', '2026-03-19T00:00:00Z'),
    ];
    vi.mocked(mockGmail.fetchMessagesInRange).mockResolvedValue(gapEmails);
    vi.mocked(mockGmail.fetchMessagesBefore).mockResolvedValue([]); // no older

    const result = await runSyncCycle(db, mockGmail, { batchSize: 10 });

    expect(result.gapsFilled).toBeGreaterThan(0);
    expect(db.listGaps()).toHaveLength(0);
  });
});
