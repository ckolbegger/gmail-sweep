import type { FastifyInstance } from 'fastify';
import type { DbHandle } from '../services/db.js';
import type { GmailService } from '../services/gmail.js';
import type { AiService } from '../services/ai.js';
import { getOrCreateSummary } from '../services/email-ops.js';
import type { EmailListParams } from '@gmail-sweep/shared';

export async function emailRoutes(
  app: FastifyInstance,
  options: { db: DbHandle; gmail: GmailService; ai: AiService }
) {
  const { db, gmail, ai } = options;

  app.get('/emails', async (request) => {
    const query = request.query as EmailListParams;

    let date_to = query.date_to;
    if (String(query.anchor_unsummarized) === 'true') {
      const anchor = db.getNextEmailWithoutSummary();
      date_to = anchor?.date ?? undefined;
    }

    const unreadParam = (request.query as any).unread as string | undefined;
    const unread = unreadParam === 'true' ? true : unreadParam === 'false' ? false : undefined;
    const label = (request.query as any).label as string | undefined;

    const emails = db.listEmails({
      sender: query.sender,
      date_from: query.date_from,
      date_to,
      subject: query.subject,
      limit: query.limit ? Number(query.limit) : undefined,
      offset: query.offset ? Number(query.offset) : undefined,
      unread,
      label,
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
    const summary = await getOrCreateSummary(db, ai, id);
    if (!summary) return reply.code(404).send({ error: 'Email not found' });
    return summary;
  });

  app.post('/emails/:id/archive', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!db.getEmail(id)) return reply.code(404).send({ error: 'Email not found' });
    db.markEmailRemoved(id, 'archived');
    try {
      await gmail.archiveMessage(id);
    } catch (err) {
      db.clearEmailRemoved(id);
      request.log.error({ err }, 'gmail archive failed, rolled back');
      return reply.code(502).send({ error: 'Gmail API error' });
    }
    return { ok: true };
  });

  app.post('/emails/:id/delete', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!db.getEmail(id)) return reply.code(404).send({ error: 'Email not found' });
    db.markEmailRemoved(id, 'deleted');
    try {
      await gmail.deleteMessage(id);
    } catch (err) {
      db.clearEmailRemoved(id);
      request.log.error({ err }, 'gmail delete failed, rolled back');
      return reply.code(502).send({ error: 'Gmail API error' });
    }
    return { ok: true };
  });

  app.post('/emails/:id/read', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!db.getEmail(id)) return reply.code(404).send({ error: 'Email not found' });
    try {
      await gmail.markRead(id);
    } catch (err) {
      request.log.error({ err }, 'gmail markRead failed');
      return reply.code(502).send({ error: 'Gmail API error' });
    }
    db.setReadState(id, true);
    return { ok: true };
  });

  app.post('/emails/:id/unread', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!db.getEmail(id)) return reply.code(404).send({ error: 'Email not found' });
    try {
      await gmail.markUnread(id);
    } catch (err) {
      request.log.error({ err }, 'gmail markUnread failed');
      return reply.code(502).send({ error: 'Gmail API error' });
    }
    db.setReadState(id, false);
    return { ok: true };
  });

  app.get('/emails/:id/raw', async (request, reply) => {
    const { id } = request.params as { id: string };
    const raw = await gmail.getRawMessage(id);
    if (!raw) return reply.code(404).send({ error: 'Message not found in Gmail' });
    return raw;
  });
}
