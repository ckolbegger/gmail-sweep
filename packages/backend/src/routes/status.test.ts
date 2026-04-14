import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { createDb } from '../services/db.js';
import { statusRoutes } from './status.js';

describe('GET /status', () => {
  it('returns ok with database=connected', async () => {
    const app = Fastify();
    const db = createDb(':memory:');
    await app.register(statusRoutes, { db });
    const res = await app.inject({ method: 'GET', url: '/status' });
    expect(res.json()).toMatchObject({ status: 'ok', database: 'connected' });
    expect(res.json().version).toBeDefined();
    db.close();
  });
});
