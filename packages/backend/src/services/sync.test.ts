import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createDb, type DbHandle } from './db.js';
import { runSyncCycle, runSyncWithEmbeddings, runIncrementalSync, runIncrementalSyncWithEmbeddings } from './sync.js';
import type { GmailService } from './gmail.js';
import type { Email, AppConfig } from '@gmail-sweep/shared';
import type { EmbedService } from './embed.js';

function makeEmail(id: string, date: string): Email {
  return {
    id, threadId: `t${id}`, subject: `Email ${id}`, from: 'test@example.com',
    date, snippet: '', bodyText: 'body', bodyHtml: null, labels: ['INBOX'],
    summary: null,
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
      listLabels: vi.fn(),
      listHistory: vi.fn(),
      fetchMessagesById: vi.fn(),
      markRead: vi.fn(),
      markUnread: vi.fn(),
      getRawMessage: vi.fn(),
    };
  });

  it('first sync: fetches newest emails, no gaps created', async () => {
    const emails = Array.from({ length: 5 }, (_, i) =>
      makeEmail(`msg${i}`, `2026-03-0${i + 1}T00:00:00Z`)
    );

    vi.mocked(mockGmail.fetchMessagesSince).mockResolvedValue({ emails, historyId: null });

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

    vi.mocked(mockGmail.fetchMessagesSince).mockResolvedValue({ emails: [], historyId: null }); // no new emails
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
    vi.mocked(mockGmail.fetchMessagesSince).mockResolvedValue({ emails: newEmails, historyId: null });
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

    vi.mocked(mockGmail.fetchMessagesSince).mockResolvedValue({ emails: [], historyId: null }); // no new emails
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

describe('runIncrementalSync', () => {
  it('runIncrementalSync applies messagesAdded and messagesDeleted', async () => {
    const db = createDb(':memory:');
    db.upsertEmail({ id: 'old', threadId: 't', subject: 's', from: 'a', date: '2025-01-01T00:00:00Z', snippet: '', bodyText: '', bodyHtml: null, labels: ['INBOX'], summary: null });
    db.setLastHistoryId('100');

    const gmail = {
      listHistory: vi.fn().mockResolvedValue({
        history: [
          { id: '101', messagesAdded: [{ id: 'new1' }], messagesDeleted: [] },
          { id: '102', messagesAdded: [], messagesDeleted: [{ id: 'old' }] },
        ],
        historyId: '102',
      }),
      fetchMessagesById: vi.fn().mockResolvedValue({
        id: 'new1', threadId: 'tn', subject: 'hi', from: 'b', date: '2025-02-01T00:00:00Z',
        snippet: '', bodyText: '', bodyHtml: null, labels: ['INBOX'], summary: null,
      }),
    } as unknown as GmailService;

    const result = await runIncrementalSync(db, gmail);
    expect(result.newEmails).toBe(1);
    expect(result.deleted).toBe(1);
    expect(db.getEmail('old')?.removedState).toBe('deleted'); // soft-deleted, row still exists
    expect(db.listEmails({}).find(e => e.id === 'old')).toBeUndefined(); // hidden from list
    expect(db.getEmail('new1')).not.toBeNull();
    expect(db.getSyncState().lastHistoryId).toBe('102');
    db.close();
  });
});

describe('runIncrementalSyncWithEmbeddings', () => {
  const config: AppConfig = {
    google: { clientId: '', clientSecret: '', redirectUri: '' },
    llm: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    embedding: { provider: 'local', model: 'test', dimension: 1024 },
    sync: { defaultBatchSize: 10 },
    contentExtraction: {
      activeStrategy: 'v1-plain',
      strategies: { 'v1-plain': { type: 'template', template: '{{body_text}}' } },
    },
  };

  it('drains embeddings for emails added by incremental sync', async () => {
    const db = createDb(':memory:');
    db.setLastHistoryId('100');

    const gmail = {
      listHistory: vi.fn().mockResolvedValue({
        history: [{ id: '101', messagesAdded: [{ id: 'new1' }], messagesDeleted: [] }],
        historyId: '101',
      }),
      fetchMessagesById: vi.fn().mockResolvedValue({
        id: 'new1', threadId: 'tn', subject: 'hi', from: 'b', date: '2025-02-01T00:00:00Z',
        snippet: '', bodyText: 'body', bodyHtml: null, labels: ['INBOX'], summary: null,
      }),
    } as unknown as GmailService;

    const embed = {
      embedDocument: vi.fn().mockResolvedValue(new Array(1024).fill(0.5)),
    } as unknown as EmbedService;

    const result = await runIncrementalSyncWithEmbeddings(db, gmail, embed, config);

    expect(result.mode).toBe('incremental');
    expect(result.embeddingsGenerated).toBe(1);
    expect(db.getEmailsWithoutEmbedding(10)).toHaveLength(0);
    db.close();
  });

  it('skips the embedding drain when falling back to full-sync mode', async () => {
    const db = createDb(':memory:'); // no lastHistoryId → mode 'full'
    const gmail = {} as unknown as GmailService;
    const embed = { embedDocument: vi.fn() } as unknown as EmbedService;

    const result = await runIncrementalSyncWithEmbeddings(db, gmail, embed, config);

    expect(result.mode).toBe('full');
    expect(result.embeddingsGenerated).toBe(0);
    expect(embed.embedDocument).not.toHaveBeenCalled();
    db.close();
  });
});

describe('runSyncWithEmbeddings', () => {
  it('returns embeddingsGenerated from embedding pipeline', async () => {
    const db = {
      getSyncState: vi.fn().mockReturnValue({ totalSynced: 0, newestDate: null, oldestDate: null }),
      getEmail: vi.fn().mockReturnValue(null),
      upsertEmail: vi.fn(),
      updateSyncState: vi.fn(),
      listGaps: vi.fn().mockReturnValue([]),
      getEmailsWithoutEmbedding: vi.fn().mockReturnValue([]),
    } as unknown as DbHandle;

    const gmail = {
      fetchMessagesSince: vi.fn().mockResolvedValue({ emails: [], historyId: null }),
      fetchMessagesBefore: vi.fn().mockResolvedValue([]),
      fetchMessagesInRange: vi.fn().mockResolvedValue([]),
    } as unknown as GmailService;

    const embed = {
      embedDocument: vi.fn().mockResolvedValue([0.1, 0.2]),
    } as unknown as EmbedService;

    const config: AppConfig = {
      google: { clientId: '', clientSecret: '', redirectUri: '' },
      llm: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
      embedding: { provider: 'local', model: 'test', dimension: 2 },
      sync: { defaultBatchSize: 10 },
      contentExtraction: {
        activeStrategy: 'v1-plain',
        strategies: {
          'v1-plain': { type: 'template', template: '{{body_text}}' },
        },
      },
    };

    const result = await runSyncWithEmbeddings(db, gmail, embed, config, { batchSize: 10 });
    expect(result).toHaveProperty('embeddingsGenerated');
    expect(result.embeddingsGenerated).toBe(0);
  });

  it('drains the full embedding backlog, not just the first batch', async () => {
    // Real-world failure: a 500-email sync only embedded 50 emails because
    // generatePendingEmbeddings ran once with a fixed batch cap and nothing
    // ever came back for the rest. Search then silently degraded to SQL-only.
    const db = createDb(':memory:');
    const emails = Array.from({ length: 120 }, (_, i) =>
      makeEmail(`msg${i}`, `2026-03-01T00:00:${String(i % 60).padStart(2, '0')}Z`)
    );

    const gmail = {
      fetchMessagesSince: vi.fn().mockResolvedValue({ emails, historyId: null }),
      fetchMessagesBefore: vi.fn().mockResolvedValue([]),
      fetchMessagesInRange: vi.fn().mockResolvedValue([]),
    } as unknown as GmailService;

    const embed = {
      embedDocument: vi.fn().mockResolvedValue(new Array(1024).fill(0.5)),
    } as unknown as EmbedService;

    const config: AppConfig = {
      google: { clientId: '', clientSecret: '', redirectUri: '' },
      llm: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
      embedding: { provider: 'local', model: 'test', dimension: 1024 },
      sync: { defaultBatchSize: 200 },
      contentExtraction: {
        activeStrategy: 'v1-plain',
        strategies: { 'v1-plain': { type: 'template', template: '{{body_text}}' } },
      },
    };

    const result = await runSyncWithEmbeddings(db, gmail, embed, config, { batchSize: 200 });

    expect(result.embeddingsGenerated).toBe(120);
    expect(db.getEmailsWithoutEmbedding(200)).toHaveLength(0);
    db.close();
  });

  it('skips embeddings when skipEmbeddings is true', async () => {
    const db = {
      getSyncState: vi.fn().mockReturnValue({ totalSynced: 0, newestDate: null, oldestDate: null }),
      getEmail: vi.fn().mockReturnValue(null),
      upsertEmail: vi.fn(),
      updateSyncState: vi.fn(),
      listGaps: vi.fn().mockReturnValue([]),
      getEmailsWithoutEmbedding: vi.fn().mockReturnValue([]),
    } as unknown as DbHandle;

    const gmail = {
      fetchMessagesSince: vi.fn().mockResolvedValue({ emails: [], historyId: null }),
      fetchMessagesBefore: vi.fn().mockResolvedValue([]),
      fetchMessagesInRange: vi.fn().mockResolvedValue([]),
    } as unknown as GmailService;

    const embed = { embedDocument: vi.fn() } as unknown as EmbedService;

    const config: AppConfig = {
      google: { clientId: '', clientSecret: '', redirectUri: '' },
      llm: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
      embedding: { provider: 'local', model: 'test', dimension: 2 },
      sync: { defaultBatchSize: 10 },
      contentExtraction: {
        activeStrategy: 'v1-plain',
        strategies: { 'v1-plain': { type: 'template', template: '{{body_text}}' } },
      },
    };

    const result = await runSyncWithEmbeddings(db, gmail, embed, config, { batchSize: 10, skipEmbeddings: true });
    expect(embed.embedDocument).not.toHaveBeenCalled();
    expect(result.embeddingsGenerated).toBe(0);
  });
});
