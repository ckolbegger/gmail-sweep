import type { FastifyInstance } from 'fastify';
import type { DbHandle } from '../services/db.js';
import type { GmailService } from '../services/gmail.js';
import type { AiService } from '../services/ai.js';
import type { EmailListParams } from '@gmail-sweep/shared';

export async function emailRoutes(
  app: FastifyInstance,
  options: { db: DbHandle; gmail: GmailService; ai: AiService }
) {
  const { db, gmail, ai } = options;

  app.get('/emails', async (request) => {
    const query = request.query as EmailListParams;
    const emails = db.listEmails({
      sender: query.sender,
      date_from: query.date_from,
      date_to: query.date_to,
      subject: query.subject,
      limit: query.limit ? Number(query.limit) : 50,
      offset: query.offset ? Number(query.offset) : 0,
    });
    return { emails };
  });

  app.get('/emails/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const email = db.getEmail(id);
    if (!email) return reply.code(404).send({ error: 'Email not found' });
    return email;
  });

  app.get('/emails/:id/summary', async (request, reply) => {
    const { id } = request.params as { id: string };
    const email = db.getEmail(id);
    if (!email) return reply.code(404).send({ error: 'Email not found' });

    if (email.summary) return email.summary;

    const summary = await ai.summarizeEmail(email.bodyText);
    db.updateSummary(id, summary);
    return summary;
  });

  app.post('/emails/:id/archive', async (request, reply) => {
    const { id } = request.params as { id: string };
    const email = db.getEmail(id);
    if (!email) return reply.code(404).send({ error: 'Email not found' });
    await gmail.archiveMessage(id);
    db.upsertEmail({ ...email, labels: email.labels.filter(l => l !== 'INBOX') });
    return { ok: true };
  });

  app.post('/emails/:id/delete', async (request, reply) => {
    const { id } = request.params as { id: string };
    const email = db.getEmail(id);
    if (!email) return reply.code(404).send({ error: 'Email not found' });
    await gmail.deleteMessage(id);
    db.upsertEmail({ ...email, labels: [...email.labels, 'TRASH'] });
    return { ok: true };
  });
}
