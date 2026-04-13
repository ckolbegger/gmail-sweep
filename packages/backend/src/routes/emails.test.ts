import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildServer } from '../server.js';
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { emailRoutes } from './emails.js';
import { createDb, type DbHandle } from '../services/db.js';
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

const seedEmail = {
  id: 'abc', threadId: 't1', subject: 'Test', from: 'a@a.com',
  date: '2024-06-01T00:00:00.000Z', snippet: '', bodyText: 'body',
  bodyHtml: null, labels: ['INBOX', 'UNREAD'], summary: null,
};

describe('F7: soft-delete archive/trash with rollback', () => {
  it('archive rolls back removed_state when Gmail API throws', async () => {
    const db = createDb(':memory:');
    db.upsertEmail(seedEmail);
    const gmailMock = {
      archiveMessage: vi.fn().mockRejectedValue(new Error('boom')),
    } as unknown as GmailService;
    const app = Fastify({ logger: false });
    await app.register(emailRoutes, { db, gmail: gmailMock, ai: {} as AiService });

    const res = await app.inject({ method: 'POST', url: '/emails/abc/archive' });
    expect(res.statusCode).toBe(502);
    expect(db.getEmail('abc')?.removedState).toBeNull();
    db.close();
  });

  it('archive sets removed_state=archived and hides email from list on success', async () => {
    const db = createDb(':memory:');
    db.upsertEmail(seedEmail);
    const gmailMock = {
      archiveMessage: vi.fn().mockResolvedValue(undefined),
    } as unknown as GmailService;
    const app = Fastify({ logger: false });
    await app.register(emailRoutes, { db, gmail: gmailMock, ai: {} as AiService });

    const res = await app.inject({ method: 'POST', url: '/emails/abc/archive' });
    expect(res.statusCode).toBe(200);
    expect(db.getEmail('abc')?.removedState).toBe('archived');
    const list = await app.inject({ method: 'GET', url: '/emails' });
    expect(list.json().emails.find((e: any) => e.id === 'abc')).toBeUndefined();
    db.close();
  });

  it('delete rolls back removed_state when Gmail API throws', async () => {
    const db = createDb(':memory:');
    db.upsertEmail(seedEmail);
    const gmailMock = {
      deleteMessage: vi.fn().mockRejectedValue(new Error('boom')),
    } as unknown as GmailService;
    const app = Fastify({ logger: false });
    await app.register(emailRoutes, { db, gmail: gmailMock, ai: {} as AiService });

    const res = await app.inject({ method: 'POST', url: '/emails/abc/delete' });
    expect(res.statusCode).toBe(502);
    expect(db.getEmail('abc')?.removedState).toBeNull();
    db.close();
  });

  it('delete sets removed_state=deleted and hides email from list on success', async () => {
    const db = createDb(':memory:');
    db.upsertEmail(seedEmail);
    const gmailMock = {
      deleteMessage: vi.fn().mockResolvedValue(undefined),
    } as unknown as GmailService;
    const app = Fastify({ logger: false });
    await app.register(emailRoutes, { db, gmail: gmailMock, ai: {} as AiService });

    const res = await app.inject({ method: 'POST', url: '/emails/abc/delete' });
    expect(res.statusCode).toBe(200);
    expect(db.getEmail('abc')?.removedState).toBe('deleted');
    const list = await app.inject({ method: 'GET', url: '/emails' });
    expect(list.json().emails.find((e: any) => e.id === 'abc')).toBeUndefined();
    db.close();
  });

  it('archive returns 404 for unknown email', async () => {
    const db = createDb(':memory:');
    const gmailMock = { archiveMessage: vi.fn() } as unknown as GmailService;
    const app = Fastify({ logger: false });
    await app.register(emailRoutes, { db, gmail: gmailMock, ai: {} as AiService });

    const res = await app.inject({ method: 'POST', url: '/emails/notexist/archive' });
    expect(res.statusCode).toBe(404);
    expect(gmailMock.archiveMessage).not.toHaveBeenCalled();
    db.close();
  });

  it('delete returns 404 for unknown email', async () => {
    const db = createDb(':memory:');
    const gmailMock = { deleteMessage: vi.fn() } as unknown as GmailService;
    const app = Fastify({ logger: false });
    await app.register(emailRoutes, { db, gmail: gmailMock, ai: {} as AiService });

    const res = await app.inject({ method: 'POST', url: '/emails/notexist/delete' });
    expect(res.statusCode).toBe(404);
    expect(gmailMock.deleteMessage).not.toHaveBeenCalled();
    db.close();
  });
});

describe('F8: mark read / mark unread endpoints', () => {
  it('POST /emails/:id/read removes UNREAD label and calls gmail.markRead', async () => {
    const db = createDb(':memory:');
    db.upsertEmail(seedEmail);
    const gmailMock = {
      markRead: vi.fn().mockResolvedValue(undefined),
    } as unknown as GmailService;
    const app = Fastify({ logger: false });
    await app.register(emailRoutes, { db, gmail: gmailMock, ai: {} as AiService });

    const res = await app.inject({ method: 'POST', url: '/emails/abc/read' });
    expect(res.statusCode).toBe(200);
    expect(db.getEmail('abc')!.labels).not.toContain('UNREAD');
    expect(gmailMock.markRead).toHaveBeenCalledWith('abc');
    db.close();
  });

  it('POST /emails/:id/unread adds UNREAD label and calls gmail.markUnread', async () => {
    const db = createDb(':memory:');
    db.upsertEmail({ ...seedEmail, labels: ['INBOX'] });
    const gmailMock = {
      markUnread: vi.fn().mockResolvedValue(undefined),
    } as unknown as GmailService;
    const app = Fastify({ logger: false });
    await app.register(emailRoutes, { db, gmail: gmailMock, ai: {} as AiService });

    const res = await app.inject({ method: 'POST', url: '/emails/abc/unread' });
    expect(res.statusCode).toBe(200);
    expect(db.getEmail('abc')!.labels).toContain('UNREAD');
    expect(gmailMock.markUnread).toHaveBeenCalledWith('abc');
    db.close();
  });

  it('POST /emails/:id/read returns 502 and does not persist when gmail throws', async () => {
    const db = createDb(':memory:');
    db.upsertEmail(seedEmail);
    const gmailMock = {
      markRead: vi.fn().mockRejectedValue(new Error('fail')),
    } as unknown as GmailService;
    const app = Fastify({ logger: false });
    await app.register(emailRoutes, { db, gmail: gmailMock, ai: {} as AiService });

    const res = await app.inject({ method: 'POST', url: '/emails/abc/read' });
    expect(res.statusCode).toBe(502);
    expect(db.getEmail('abc')!.labels).toContain('UNREAD');
    db.close();
  });

  it('POST /emails/:id/read returns 404 for unknown email', async () => {
    const db = createDb(':memory:');
    const gmailMock = { markRead: vi.fn() } as unknown as GmailService;
    const app = Fastify({ logger: false });
    await app.register(emailRoutes, { db, gmail: gmailMock, ai: {} as AiService });

    const res = await app.inject({ method: 'POST', url: '/emails/notexist/read' });
    expect(res.statusCode).toBe(404);
    db.close();
  });
});

describe('F10: raw gmail message passthrough', () => {
  it('GET /emails/:id/raw returns raw gmail response', async () => {
    const fake = { id: 'abc', payload: { headers: [] }, labelIds: ['INBOX'] };
    const gmailMock = {
      getRawMessage: vi.fn().mockResolvedValue(fake),
    } as unknown as GmailService;
    const app = Fastify({ logger: false });
    const db = createDb(':memory:');
    await app.register(emailRoutes, { db, gmail: gmailMock, ai: {} as AiService });

    const res = await app.inject({ method: 'GET', url: '/emails/abc/raw' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(fake);
    db.close();
  });

  it('GET /emails/:id/raw returns 404 when gmail returns null', async () => {
    const gmailMock = {
      getRawMessage: vi.fn().mockResolvedValue(null),
    } as unknown as GmailService;
    const app = Fastify({ logger: false });
    const db = createDb(':memory:');
    await app.register(emailRoutes, { db, gmail: gmailMock, ai: {} as AiService });

    const res = await app.inject({ method: 'GET', url: '/emails/notexist/raw' });
    expect(res.statusCode).toBe(404);
    db.close();
  });
});

describe('F9/F11: unread and label filters on GET /emails', () => {
  it('filters emails by ?unread=true', async () => {
    const db = createDb(':memory:');
    db.upsertEmail({ id: 'u', threadId: 't1', subject: 's', from: 'x',
      date: '2025-01-01T00:00:00Z', snippet: '', bodyText: '', bodyHtml: null,
      labels: ['INBOX', 'UNREAD'], summary: null });
    db.upsertEmail({ id: 'r', threadId: 't2', subject: 's', from: 'x',
      date: '2025-01-02T00:00:00Z', snippet: '', bodyText: '', bodyHtml: null,
      labels: ['INBOX'], summary: null });
    const app = Fastify({ logger: false });
    await app.register(emailRoutes, { db, gmail: {} as GmailService, ai: {} as AiService });

    const res = await app.inject({ method: 'GET', url: '/emails?unread=true' });
    expect(res.json().emails.map((e: any) => e.id)).toEqual(['u']);
    db.close();
  });

  it('filters emails by ?label=Label_1', async () => {
    const db = createDb(':memory:');
    db.upsertEmail({ id: '1', threadId: 't1', subject: 's', from: 'x',
      date: '2025-01-01T00:00:00Z', snippet: '', bodyText: '', bodyHtml: null,
      labels: ['INBOX', 'Label_1'], summary: null });
    db.upsertEmail({ id: '2', threadId: 't2', subject: 's', from: 'x',
      date: '2025-01-02T00:00:00Z', snippet: '', bodyText: '', bodyHtml: null,
      labels: ['INBOX'], summary: null });
    const app = Fastify({ logger: false });
    await app.register(emailRoutes, { db, gmail: {} as GmailService, ai: {} as AiService });

    const res = await app.inject({ method: 'GET', url: '/emails?label=Label_1' });
    expect(res.json().emails.map((e: any) => e.id)).toEqual(['1']);
    db.close();
  });
});

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
