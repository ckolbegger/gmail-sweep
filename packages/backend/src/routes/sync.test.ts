import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { syncRoutes } from './sync.js';
import type { SummarizerWorker } from '../services/summarizer.js';
import type { Gap } from '@gmail-sweep/shared';

vi.mock('../services/sync.js', () => ({
  runSyncWithEmbeddings: vi.fn(),
}));

import { runSyncWithEmbeddings } from '../services/sync.js';

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
