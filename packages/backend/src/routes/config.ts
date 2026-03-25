import type { FastifyInstance } from 'fastify';
import { loadConfig, saveConfig } from '../config.js';
import type { AppConfig } from '@gmail-sweep/shared';

export async function configRoutes(app: FastifyInstance) {
  app.get('/config', async () => loadConfig());

  app.post('/config', async (request) => {
    const updates = request.body as Partial<AppConfig>;
    const current = await loadConfig();
    const merged = { ...current, ...updates };
    await saveConfig(merged);
    return merged;
  });
}
