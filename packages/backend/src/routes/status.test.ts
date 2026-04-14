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

  it('returns database=error when db ping fails', async () => {
    const app = Fastify();
    const db = createDb(':memory:');
    db.close(); // close before ping so SELECT 1 throws
    await app.register(statusRoutes, { db });
    const res = await app.inject({ method: 'GET', url: '/status' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', database: 'error' });
  });
});
