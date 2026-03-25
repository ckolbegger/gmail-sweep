import Fastify from 'fastify';

export function buildServer() {
  const app = Fastify({ logger: true });

  // Routes registered in later tasks
  app.get('/health', async () => ({ status: 'ok' }));

  return app;
}
