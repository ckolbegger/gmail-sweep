import { describe, it, expect, beforeEach } from 'vitest';
import { createDb, type DbHandle } from './db.js';

describe('database service', () => {
  let db: DbHandle;

  beforeEach(() => {
    db = createDb(':memory:');
  });

  describe('emails', () => {
    it('inserts and retrieves an email', () => {
      db.upsertEmail({
        id: 'msg1',
        threadId: 'thread1',
        subject: 'Test email',
        from: 'alice@example.com',
        date: '2026-03-23T10:00:00Z',
        snippet: 'Hello world',
        bodyText: 'Hello world, this is a test email.',
        bodyHtml: null,
        labels: ['INBOX'],
        summary: null,
      });

      const email = db.getEmail('msg1');
      expect(email).not.toBeNull();
      expect(email!.subject).toBe('Test email');
      expect(email!.from).toBe('alice@example.com');
      expect(email!.labels).toEqual(['INBOX']);
    });

    it('lists emails sorted by date descending', () => {
      db.upsertEmail({ id: 'old', threadId: 't1', subject: 'Old', from: 'a@b.com',
        date: '2026-01-01T00:00:00Z', snippet: '', bodyText: '', bodyHtml: null,
        labels: ['INBOX'], summary: null });
      db.upsertEmail({ id: 'new', threadId: 't2', subject: 'New', from: 'a@b.com',
        date: '2026-03-23T00:00:00Z', snippet: '', bodyText: '', bodyHtml: null,
        labels: ['INBOX'], summary: null });

      const emails = db.listEmails({});
      expect(emails[0].id).toBe('new');
      expect(emails[1].id).toBe('old');
    });

    it('excludes archived and trashed emails', () => {
      db.upsertEmail({ id: 'inbox', threadId: 't1', subject: 'S', from: 'a@b.com',
        date: '2026-03-01T00:00:00Z', snippet: '', bodyText: '', bodyHtml: null,
        labels: ['INBOX'], summary: null });
      db.upsertEmail({ id: 'archived', threadId: 't2', subject: 'S', from: 'a@b.com',
        date: '2026-03-01T00:00:00Z', snippet: '', bodyText: '', bodyHtml: null,
        labels: [], summary: null });
      db.upsertEmail({ id: 'trashed', threadId: 't3', subject: 'S', from: 'a@b.com',
        date: '2026-03-01T00:00:00Z', snippet: '', bodyText: '', bodyHtml: null,
        labels: ['TRASH'], summary: null });

      const results = db.listEmails({});
      expect(results.map(e => e.id)).toEqual(['inbox']);
    });

    it('filters emails by sender', () => {
      db.upsertEmail({ id: 'a', threadId: 't1', subject: 'S', from: 'alice@example.com',
        date: '2026-03-01T00:00:00Z', snippet: '', bodyText: '', bodyHtml: null,
        labels: ['INBOX'], summary: null });
      db.upsertEmail({ id: 'b', threadId: 't2', subject: 'S', from: 'bob@example.com',
        date: '2026-03-01T00:00:00Z', snippet: '', bodyText: '', bodyHtml: null,
        labels: ['INBOX'], summary: null });

      const results = db.listEmails({ sender: 'alice' });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('a');
    });

    it('updates summary on existing email', () => {
      db.upsertEmail({ id: 'msg1', threadId: 't1', subject: 'S', from: 'a@b.com',
        date: '2026-03-01T00:00:00Z', snippet: '', bodyText: '', bodyHtml: null,
        labels: [], summary: null });

      db.updateSummary('msg1', { description: 'A test', actionItems: [], keyPoints: [] });

      const email = db.getEmail('msg1');
      expect(email!.summary).toEqual({ description: 'A test', actionItems: [], keyPoints: [] });
    });

    it('archiveEmail removes INBOX label', () => {
      db.upsertEmail({
        id: 'msg1', threadId: 't1', subject: 'Test', from: 'a@b.com',
        date: '2026-03-01T00:00:00Z', snippet: '', bodyText: '', bodyHtml: null,
        labels: ['INBOX', 'UNREAD'], summary: null,
      });

      db.archiveEmail('msg1');

      const updated = db.getEmail('msg1');
      expect(updated!.labels).not.toContain('INBOX');
      expect(updated!.labels).toContain('UNREAD');
    });

    it('archiveEmail is a no-op for unknown id', () => {
      expect(() => db.archiveEmail('nonexistent')).not.toThrow();
    });

    it('trashEmail adds TRASH label', () => {
      db.upsertEmail({
        id: 'msg2', threadId: 't2', subject: 'Test', from: 'a@b.com',
        date: '2026-03-01T00:00:00Z', snippet: '', bodyText: '', bodyHtml: null,
        labels: ['INBOX'], summary: null,
      });

      db.trashEmail('msg2');

      const updated = db.getEmail('msg2');
      expect(updated!.labels).toContain('TRASH');
    });

    it('trashEmail does not duplicate TRASH label', () => {
      db.upsertEmail({
        id: 'msg3', threadId: 't3', subject: 'Test', from: 'a@b.com',
        date: '2026-03-01T00:00:00Z', snippet: '', bodyText: '', bodyHtml: null,
        labels: ['TRASH'], summary: null,
      });

      db.trashEmail('msg3');

      const updated = db.getEmail('msg3');
      expect(updated!.labels.filter(l => l === 'TRASH')).toHaveLength(1);
    });
  });

  describe('sync state', () => {
    it('returns null state when no sync has occurred', () => {
      const state = db.getSyncState();
      expect(state.totalSynced).toBe(0);
      expect(state.newestDate).toBeNull();
      expect(state.oldestDate).toBeNull();
    });

    it('updates sync state', () => {
      db.updateSyncState({ newestDate: '2026-03-23T00:00:00Z', oldestDate: '2026-01-01T00:00:00Z', totalSynced: 100 });
      const state = db.getSyncState();
      expect(state.totalSynced).toBe(100);
      expect(state.newestDate).toBe('2026-03-23T00:00:00Z');
    });
  });

  describe('gap management', () => {
    it('creates and lists gaps', () => {
      db.createGap({ newerBoundary: '2026-03-20T00:00:00Z', olderBoundary: '2026-03-15T00:00:00Z', estimatedCount: 200 });
      const gaps = db.listGaps();
      expect(gaps).toHaveLength(1);
      expect(gaps[0].estimatedCount).toBe(200);
    });

    it('deletes a gap when fully filled', () => {
      db.createGap({ newerBoundary: '2026-03-20T00:00:00Z', olderBoundary: '2026-03-15T00:00:00Z', estimatedCount: 200 });
      const [gap] = db.listGaps();
      db.deleteGap(gap.id);
      expect(db.listGaps()).toHaveLength(0);
    });

    it('updates gap boundaries when partially filled', () => {
      db.createGap({ newerBoundary: '2026-03-20T00:00:00Z', olderBoundary: '2026-03-10T00:00:00Z', estimatedCount: 500 });
      const [gap] = db.listGaps();
      db.updateGapBoundary(gap.id, { olderBoundary: '2026-03-15T00:00:00Z', estimatedCount: 250 });
      const updated = db.listGaps()[0];
      expect(updated.olderBoundary).toBe('2026-03-15T00:00:00Z');
      expect(updated.estimatedCount).toBe(250);
    });
  });

  describe('getNextEmailWithoutSummary / countEmailsWithoutSummary', () => {
    let db: DbHandle;

    beforeEach(() => {
      db = createDb(':memory:');
      db.upsertEmail({
        id: 'a', threadId: 't1', subject: 'Older', from: 'x@x.com',
        date: '2024-01-01T00:00:00.000Z', snippet: '', bodyText: 'body',
        bodyHtml: null, labels: [], summary: null,
      });
      db.upsertEmail({
        id: 'b', threadId: 't2', subject: 'Newer', from: 'y@y.com',
        date: '2024-06-01T00:00:00.000Z', snippet: '', bodyText: 'body',
        bodyHtml: null, labels: [], summary: null,
      });
    });

    it('returns the newest email without a summary', () => {
      const email = db.getNextEmailWithoutSummary();
      expect(email?.id).toBe('b');
    });

    it('returns null when all emails have summaries', () => {
      const summary = { description: 'd', actionItems: [], keyPoints: [] };
      db.updateSummary('a', summary);
      db.updateSummary('b', summary);
      expect(db.getNextEmailWithoutSummary()).toBeNull();
    });

    it('counts emails without summaries', () => {
      expect(db.countEmailsWithoutSummary()).toBe(2);
      db.updateSummary('a', { description: 'd', actionItems: [], keyPoints: [] });
      expect(db.countEmailsWithoutSummary()).toBe(1);
    });
  });

  describe('vec_embeddings', () => {
    function makeVec(val: number): number[] {
      // 1024-dim vector, all components equal to val (unit-normalized for cosine)
      const dim = 1024;
      const norm = Math.sqrt(dim * val * val);
      return new Array(dim).fill(val / norm);
    }

    beforeEach(() => {
      db.upsertEmail({ id: 'e1', threadId: 't1', subject: 'A', from: 'a@b.com',
        date: '2026-03-01T00:00:00Z', snippet: '', bodyText: '', bodyHtml: null,
        labels: [], summary: null });
      db.upsertEmail({ id: 'e2', threadId: 't2', subject: 'B', from: 'b@b.com',
        date: '2026-03-02T00:00:00Z', snippet: '', bodyText: '', bodyHtml: null,
        labels: [], summary: null });
      db.upsertEmail({ id: 'e3', threadId: 't3', subject: 'C', from: 'c@b.com',
        date: '2026-03-03T00:00:00Z', snippet: '', bodyText: '', bodyHtml: null,
        labels: [], summary: null });
    });

    it('searchEmbeddings returns top-k results ordered by distance', () => {
      const v1 = makeVec(1.0);   // all positive
      const v2 = makeVec(-1.0);  // all negative (opposite direction)
      const v3 = makeVec(0.5);   // same direction as v1, same angle

      db.upsertEmbedding('e1', v1);
      db.upsertEmbedding('e2', v2);
      db.upsertEmbedding('e3', v3);

      // Query with v1 — e1 and e3 should be closest (distance ~0), e2 furthest
      const results = db.searchEmbeddings(v1, 3);
      expect(results).toHaveLength(3);
      expect(results[0].emailId).not.toBe('e2');   // e2 is furthest
      expect(results[2].emailId).toBe('e2');        // e2 should be last
      // distances should be ascending
      expect(results[0].distance).toBeLessThanOrEqual(results[1].distance);
      expect(results[1].distance).toBeLessThanOrEqual(results[2].distance);
    });

    it('upsertEmbedding is idempotent — only one row, second vector wins', () => {
      const v1 = makeVec(1.0);
      const v2 = makeVec(-1.0);

      db.upsertEmbedding('e1', v1);
      db.upsertEmbedding('e1', v2);  // overwrite

      // Query with v2 — e1 should be very close (small distance)
      const results = db.searchEmbeddings(v2, 1);
      expect(results).toHaveLength(1);
      expect(results[0].emailId).toBe('e1');
      expect(results[0].distance).toBeLessThan(0.01);
    });

    it('getEmailsWithoutEmbedding returns only emails with no embedding', () => {
      db.upsertEmbedding('e1', makeVec(1.0));
      db.upsertEmbedding('e2', makeVec(0.5));
      // e3 has no embedding

      const pending = db.getEmailsWithoutEmbedding(10);
      expect(pending).toHaveLength(1);
      expect(pending[0].id).toBe('e3');
    });
  });
});
