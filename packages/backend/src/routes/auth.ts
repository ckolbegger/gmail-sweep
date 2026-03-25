import type { FastifyInstance } from 'fastify';
import type { GmailService } from '../services/gmail.js';

export async function authRoutes(app: FastifyInstance, options: { gmail: GmailService }) {
  const { gmail } = options;

  app.get('/auth/url', async () => {
    return { url: gmail.getAuthUrl() };
  });

  app.get('/auth/callback', async (request, reply) => {
    const { code } = request.query as { code?: string };
    if (!code) return reply.code(400).send({ error: 'Missing code parameter' });
    const email = await gmail.handleCallback(code);
    return reply.redirect(`/?authenticated=true&email=${encodeURIComponent(email)}`);
  });

  app.get('/auth/status', async () => {
    const authenticated = await gmail.isAuthenticated();
    const email = authenticated ? await gmail.getAuthenticatedEmail() : null;
    return { authenticated, email };
  });

  app.delete('/auth/logout', async () => {
    await gmail.revokeToken();
    return { ok: true };
  });
}
