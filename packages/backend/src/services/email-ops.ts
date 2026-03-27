import type { DbHandle } from './db.js';
import type { AiService } from './ai.js';
import type { EmailSummary } from '@gmail-sweep/shared';

export async function getOrCreateSummary(
  db: DbHandle,
  ai: AiService,
  emailId: string
): Promise<EmailSummary | null> {
  const email = db.getEmail(emailId);
  if (!email) return null;
  if (email.summary) return email.summary;
  const summary = await ai.summarizeEmail(email.bodyText);
  db.updateSummary(emailId, summary);
  return summary;
}
