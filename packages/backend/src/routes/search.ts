import type { FastifyInstance } from 'fastify';
import type { SearchService } from '../services/search.js';
import type { SearchRequest } from '@gmail-sweep/shared';

export async function searchRoutes(
  app: FastifyInstance,
  options: { search: SearchService }
) {
  app.post('/search', async (request) => {
    const body = request.body as SearchRequest;
    return options.search.search(body);
  });
}
