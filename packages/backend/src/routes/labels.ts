import type { FastifyInstance } from 'fastify';
import type { GmailService } from '../services/gmail.js';

export async function labelsRoutes(app: FastifyInstance, options: { gmail: GmailService }) {
  app.get('/labels', async () => {
    const labels = await options.gmail.listLabels();
    return { labels };
  });
}
