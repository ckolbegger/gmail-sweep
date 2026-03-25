import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildServer } from '../server.js';
import type { FastifyInstance } from 'fastify';

// Mock the gmail service factory
vi.mock('../services/gmail.js', () => ({
  createGmailService: vi.fn().mockReturnValue({
    getAuthUrl: vi.fn().mockReturnValue('https://accounts.google.com/oauth?...'),
    isAuthenticated: vi.fn().mockResolvedValue(true),
    getAuthenticatedEmail: vi.fn().mockResolvedValue('user@gmail.com'),
    handleCallback: vi.fn().mockResolvedValue('user@gmail.com'),
    revokeToken: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('../config.js', () => ({
  loadConfig: vi.fn().mockResolvedValue({
    google: { clientId: 'id', clientSecret: 'secret', redirectUri: 'http://localhost:3141/auth/callback' },
    llm: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    embedding: { provider: 'local', model: 'Xenova/bge-m3', dimension: 1024 },
    sync: { defaultBatchSize: 500 },
    contentExtraction: { activeStrategy: 'v1-plain', strategies: {} },
  }),
  saveConfig: vi.fn(),
  getDefaultConfig: vi.fn(),
}));

describe('auth routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildServer({ dbPath: ':memory:' });
  });

  it('GET /auth/url returns an auth URL', async () => {
    const res = await app.inject({ method: 'GET', url: '/auth/url' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.url).toContain('accounts.google.com');
  });

  it('GET /auth/status returns authenticated status', async () => {
    const res = await app.inject({ method: 'GET', url: '/auth/status' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.authenticated).toBe(true);
    expect(body.email).toBe('user@gmail.com');
  });
});
