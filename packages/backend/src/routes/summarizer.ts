import type { FastifyInstance } from 'fastify';
import type { SummarizerWorker } from '../services/summarizer.js';

export async function summarizerRoutes(
  app: FastifyInstance,
  options: { summarizer: SummarizerWorker }
) {
  const { summarizer } = options;

  app.get('/summarizer/status', async () => {
    return summarizer.getStatus();
  });
}
