import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createDb, type DbHandle } from './db.js';
import { generatePendingEmbeddings } from './embeddings.js';
import type { EmbedService } from './embed.js';
import type { ExtractionStrategy } from '@gmail-sweep/shared';

describe('generatePendingEmbeddings', () => {
  let db: DbHandle;
  let mockEmbed: EmbedService;
  const strategy: ExtractionStrategy = { type: 'template', template: 'Subject: {{subject}}\n\n{{body_text}}' };

  beforeEach(() => {
    db = createDb(':memory:');
    mockEmbed = {
      embedDocument: vi.fn().mockResolvedValue(new Array(1024).fill(0.5)),
      embedQuery: vi.fn(),
    };
  });

  it('generates embeddings for emails that have none', async () => {
    db.upsertEmail({ id: 'msg1', threadId: 't1', subject: 'Hello', from: 'a@b.com',
      date: '2026-03-01T00:00:00Z', snippet: '', bodyText: 'Hello world', bodyHtml: null,
      labels: [], summary: null });

    const count = await generatePendingEmbeddings(db, mockEmbed, strategy,10);

    expect(count).toBe(1);
    expect(mockEmbed.embedDocument).toHaveBeenCalledOnce();
    // Verify the embedding was stored by checking getEmailsWithoutEmbedding
    expect(db.getEmailsWithoutEmbedding(10)).toHaveLength(0);
  });

  it('skips emails that already have an embedding', async () => {
    db.upsertEmail({ id: 'msg1', threadId: 't1', subject: 'Hello', from: 'a@b.com',
      date: '2026-03-01T00:00:00Z', snippet: '', bodyText: 'Hello world', bodyHtml: null,
      labels: [], summary: null });
    db.upsertEmbedding('msg1', new Array(1024).fill(0.5));

    const count = await generatePendingEmbeddings(db, mockEmbed, strategy,10);

    expect(count).toBe(0);
    expect(mockEmbed.embedDocument).not.toHaveBeenCalled();
  });

  it('respects the batch limit', async () => {
    for (let i = 0; i < 5; i++) {
      db.upsertEmail({ id: `msg${i}`, threadId: `t${i}`, subject: `Email ${i}`, from: 'a@b.com',
        date: '2026-03-01T00:00:00Z', snippet: '', bodyText: 'body', bodyHtml: null,
        labels: [], summary: null });
    }

    const count = await generatePendingEmbeddings(db, mockEmbed, strategy,3);

    expect(count).toBe(3);
    expect(mockEmbed.embedDocument).toHaveBeenCalledTimes(3);
  });
});
