import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { summarizerRoutes } from './summarizer.js';
import type { SummarizerWorker } from '../services/summarizer.js';

function makeWorker(overrides: Partial<ReturnType<SummarizerWorker['getStatus']>> = {}): SummarizerWorker {
  return {
    trigger: vi.fn(),
    getStatus: vi.fn().mockReturnValue({
      status: 'idle',
      processed: 0,
      pending: 0,
      ...overrides,
    }),
  };
}

describe('GET /summarizer/status', () => {
  it('returns idle status with zeros when worker is not running', async () => {
    const app = Fastify();
    await app.register(summarizerRoutes, { summarizer: makeWorker() });

    const res = await app.inject({ method: 'GET', url: '/summarizer/status' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ status: 'idle', processed: 0, pending: 0 });
  });

  it('returns running status with counts when worker is active', async () => {
    const app = Fastify();
    await app.register(summarizerRoutes, { summarizer: makeWorker({ status: 'running', processed: 2, pending: 5 }) });

    const res = await app.inject({ method: 'GET', url: '/summarizer/status' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ status: 'running', processed: 2, pending: 5 });
  });
});
