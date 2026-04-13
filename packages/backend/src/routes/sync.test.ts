import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { syncRoutes } from './sync.js';
import type { SummarizerWorker } from '../services/summarizer.js';
import type { Gap } from '@gmail-sweep/shared';
import { createDb, type DbHandle } from '../services/db.js';

vi.mock('../services/sync.js', () => ({
  runSyncWithEmbeddings: vi.fn(),
  runIncrementalSync: vi.fn(),
  fillSingleGap: vi.fn(),
}));

import { runSyncWithEmbeddings, runIncrementalSync, fillSingleGap } from '../services/sync.js';

const mockSyncResult = {
  fetched: 10,
  newEmails: 10,
  gapsFilled: 0,
  olderFetched: 0,
  remainingGaps: [] as Gap[],
  embeddingsGenerated: 10,
};

function makeDeps(summarizerOverrides?: Partial<SummarizerWorker>) {
  return {
    db: {} as any,
    gmail: {} as any,
    embed: {} as any,
    config: {} as any,
    defaultBatchSize: 500,
    summarizer: {
      trigger: vi.fn(),
      getStatus: vi.fn().mockReturnValue({ status: 'idle', processed: 0, pending: 0 }),
      ...summarizerOverrides,
    } as SummarizerWorker,
  };
}

describe('POST /sync/incremental', () => {
  it('calls runIncrementalSync and returns result', async () => {
    const incrementalResult = { fetched: 1, newEmails: 1, gapsFilled: 0, olderFetched: 0, deleted: 0, remainingGaps: [], mode: 'incremental' as const };
    vi.mocked(runIncrementalSync).mockResolvedValueOnce(incrementalResult);
    const deps = makeDeps();
    const app = Fastify();
    await app.register(syncRoutes, deps);
    const res = await app.inject({ method: 'POST', url: '/sync/incremental' });
    expect(res.statusCode).toBe(200);
    expect(res.json().mode).toBe('incremental');
  });
});

describe('gap fill/abandon routes', () => {
  let db: DbHandle;
  let gmailMock: any;

  beforeEach(() => {
    db = createDb(':memory:');
    gmailMock = { fetchMessagesInRange: vi.fn() };
  });

  it('POST /sync/gaps/:id/fill fills from gmail', async () => {
    const gap = db.createGap({ newerBoundary: '2025-02-01T00:00:00Z', olderBoundary: '2025-01-01T00:00:00Z', estimatedCount: 0 });
    vi.mocked(fillSingleGap).mockResolvedValueOnce({ fetched: 1, remaining: null });
    const deps = { db, gmail: gmailMock as any, embed: {} as any, config: {} as any, defaultBatchSize: 500, summarizer: { trigger: vi.fn(), getStatus: vi.fn() } as any };
    const app = Fastify();
    await app.register(syncRoutes, deps);
    const res = await app.inject({ method: 'POST', url: `/sync/gaps/${gap.id}/fill` });
    expect(res.statusCode).toBe(200);
    expect(res.json().fetched).toBe(1);
  });

  it('DELETE /sync/gaps/:id removes the gap', async () => {
    const gap = db.createGap({ newerBoundary: '2025-02-01', olderBoundary: '2025-01-01', estimatedCount: 0 });
    const deps = { db, gmail: gmailMock as any, embed: {} as any, config: {} as any, defaultBatchSize: 500, summarizer: { trigger: vi.fn(), getStatus: vi.fn() } as any };
    const app = Fastify();
    await app.register(syncRoutes, deps);
    const res = await app.inject({ method: 'DELETE', url: `/sync/gaps/${gap.id}` });
    expect(res.statusCode).toBe(200);
    expect(db.listGaps()).toHaveLength(0);
  });

  it('POST /sync/gaps/:id/fill returns 404 for missing gap', async () => {
    const deps = { db, gmail: gmailMock as any, embed: {} as any, config: {} as any, defaultBatchSize: 500, summarizer: { trigger: vi.fn(), getStatus: vi.fn() } as any };
    const app = Fastify();
    await app.register(syncRoutes, deps);
    const res = await app.inject({ method: 'POST', url: '/sync/gaps/9999/fill' });
    expect(res.statusCode).toBe(404);
  });

  it('DELETE /sync/gaps/:id returns 404 for missing gap', async () => {
    const deps = { db, gmail: gmailMock as any, embed: {} as any, config: {} as any, defaultBatchSize: 500, summarizer: { trigger: vi.fn(), getStatus: vi.fn() } as any };
    const app = Fastify();
    await app.register(syncRoutes, deps);
    const res = await app.inject({ method: 'DELETE', url: '/sync/gaps/9999' });
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /sync', () => {
  it('calls summarizer.trigger() after a successful sync', async () => {
    vi.mocked(runSyncWithEmbeddings).mockResolvedValueOnce(mockSyncResult);
    const deps = makeDeps();
    const app = Fastify();
    await app.register(syncRoutes, deps);

    await app.inject({ method: 'POST', url: '/sync' });
    expect(deps.summarizer.trigger).toHaveBeenCalledOnce();
  });

  it('does NOT call summarizer.trigger() if sync throws', async () => {
    vi.mocked(runSyncWithEmbeddings).mockRejectedValueOnce(new Error('gmail down'));
    const deps = makeDeps();
    const app = Fastify();
    await app.register(syncRoutes, deps);

    await app.inject({ method: 'POST', url: '/sync' });
    expect(deps.summarizer.trigger).not.toHaveBeenCalled();
  });

  it('returns the sync result', async () => {
    vi.mocked(runSyncWithEmbeddings).mockResolvedValueOnce(mockSyncResult);
    const deps = makeDeps();
    const app = Fastify();
    await app.register(syncRoutes, deps);

    const res = await app.inject({ method: 'POST', url: '/sync' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual(mockSyncResult);
  });
});
