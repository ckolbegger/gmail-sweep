import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildServer } from '../server.js';
import type { FastifyInstance } from 'fastify';

vi.mock('../config.js', () => ({
  loadConfig: vi.fn().mockResolvedValue({
    google: { clientId: 'id', clientSecret: 'secret', redirectUri: 'http://localhost:3141/auth/callback' },
    llm: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    embedding: { provider: 'local', model: 'Xenova/bge-m3', dimension: 1024 },
    sync: { defaultBatchSize: 500 },
    contentExtraction: { activeStrategy: 'v1-plain', strategies: { 'v1-plain': { type: 'template', template: 'Subject: {{subject}}\n\n{{body_text}}' } } },
  }),
  saveConfig: vi.fn(),
  getDefaultConfig: vi.fn(),
}));

describe('email routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildServer({ dbPath: ':memory:' });
  });

  it('GET /emails returns empty list when no emails synced', async () => {
    const res = await app.inject({ method: 'GET', url: '/emails' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body.emails)).toBe(true);
    expect(body.emails).toHaveLength(0);
  });

  it('GET /emails/:id returns 404 for unknown email', async () => {
    const res = await app.inject({ method: 'GET', url: '/emails/nonexistent' });
    expect(res.statusCode).toBe(404);
  });
});
