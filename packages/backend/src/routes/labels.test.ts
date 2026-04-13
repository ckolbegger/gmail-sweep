import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { labelsRoutes } from './labels.js';

describe('GET /labels', () => {
  it('returns labels from gmail service', async () => {
    const app = Fastify();
    const gmail = { listLabels: async () => [{ id: 'INBOX', name: 'INBOX' }, { id: 'Label_1', name: 'Work' }] } as any;
    await app.register(labelsRoutes, { gmail });
    const res = await app.inject({ method: 'GET', url: '/labels' });
    expect(res.statusCode).toBe(200);
    expect(res.json().labels).toHaveLength(2);
  });
});
