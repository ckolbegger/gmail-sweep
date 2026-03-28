import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildServer } from '../server.js';
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { emailRoutes } from './emails.js';
import type { DbHandle } from '../services/db.js';
import type { GmailService } from '../services/gmail.js';
import type { AiService } from '../services/ai.js';

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

const baseEmail = {
  id: 'e1', threadId: 't1', subject: 'Hello', from: 'a@a.com',
  date: '2024-06-01T00:00:00.000Z', snippet: '', bodyText: 'body',
  bodyHtml: null, labels: [], summary: null,
  hasEmbedding: false, embeddingStrategy: null,
};

function makeEmailDeps(overrides: {
  listEmails?: DbHandle['listEmails'];
  getNextEmailWithoutSummary?: DbHandle['getNextEmailWithoutSummary'];
}) {
  return {
    db: {
      listEmails: overrides.listEmails ?? vi.fn().mockReturnValue([]),
      getNextEmailWithoutSummary: overrides.getNextEmailWithoutSummary ?? vi.fn().mockReturnValue(null),
    } as unknown as DbHandle,
    gmail: {} as GmailService,
    ai: {} as AiService,
  };
}

describe('GET /emails with anchor_unsummarized', () => {
  it('uses the unsummarized email date as date_to when anchor_unsummarized=true', async () => {
    const listEmails = vi.fn().mockReturnValue([baseEmail]);
    const deps = makeEmailDeps({
      listEmails,
      getNextEmailWithoutSummary: vi.fn().mockReturnValue(baseEmail),
    });
    const app = Fastify();
    await app.register(emailRoutes, deps);

    await app.inject({ method: 'GET', url: '/emails?anchor_unsummarized=true&limit=200' });

    expect(listEmails).toHaveBeenCalledWith(
      expect.objectContaining({ date_to: baseEmail.date, limit: 200 })
    );
  });

  it('applies no date_to filter when anchor_unsummarized=true but all emails are summarized', async () => {
    const listEmails = vi.fn().mockReturnValue([]);
    const deps = makeEmailDeps({
      listEmails,
      getNextEmailWithoutSummary: vi.fn().mockReturnValue(null),
    });
    const app = Fastify();
    await app.register(emailRoutes, deps);

    await app.inject({ method: 'GET', url: '/emails?anchor_unsummarized=true&limit=200' });

    expect(listEmails).toHaveBeenCalledWith(
      expect.objectContaining({ date_to: undefined })
    );
  });

  it('ignores anchor_unsummarized when not set', async () => {
    const getNextEmailWithoutSummary = vi.fn();
    const deps = makeEmailDeps({ getNextEmailWithoutSummary });
    const app = Fastify();
    await app.register(emailRoutes, deps);

    await app.inject({ method: 'GET', url: '/emails' });

    expect(getNextEmailWithoutSummary).not.toHaveBeenCalled();
  });
});
