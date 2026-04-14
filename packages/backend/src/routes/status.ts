import type { FastifyInstance } from 'fastify';
import type { DbHandle } from '../services/db.js';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf-8')) as { version: string };

export async function statusRoutes(app: FastifyInstance, opts: { db: DbHandle }) {
  app.get('/status', async () => ({
    status: 'ok',
    version: pkg.version,
    database: opts.db.ping() ? 'connected' : 'error',
  }));
}
