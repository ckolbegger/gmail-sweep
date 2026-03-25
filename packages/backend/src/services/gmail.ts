import { OAuth2Client } from 'google-auth-library';
import { google } from 'googleapis';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { Email } from '@gmail-sweep/shared';
import { extractBodyText } from './content.js';

interface GmailMessage {
  id: string;
  threadId: string;
  internalDate: string;
  snippet: string;
  labelIds: string[];
  payload: {
    headers: Array<{ name: string; value: string }>;
    parts?: Array<{ mimeType: string; body: { data?: string }; parts?: unknown[] }>;
    mimeType: string;
    body: { data?: string };
  };
}

function getTokensPath(): string {
  return path.join(os.homedir(), '.gmail-sweep', 'tokens.json');
}

function decodeBase64(encoded: string): string {
  return Buffer.from(encoded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
}

function extractPart(payload: GmailMessage['payload'], mimeType: string): string | null {
  if (payload.mimeType === mimeType && payload.body.data) {
    return decodeBase64(payload.body.data);
  }
  for (const part of payload.parts ?? []) {
    const p = part as GmailMessage['payload'];
    const found = extractPart(p, mimeType);
    if (found) return found;
  }
  return null;
}

function messageToEmail(msg: GmailMessage): Email {
  const headers = msg.payload.headers ?? [];
  const header = (name: string) => headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';

  const plainText = extractPart(msg.payload, 'text/plain');
  const htmlBody = extractPart(msg.payload, 'text/html');
  const bodyText = extractBodyText(plainText, htmlBody);
  const date = new Date(Number(msg.internalDate)).toISOString();

  return {
    id: msg.id,
    threadId: msg.threadId,
    subject: header('Subject'),
    from: header('From'),
    date,
    snippet: msg.snippet ?? '',
    bodyText,
    bodyHtml: htmlBody,
    labels: msg.labelIds ?? [],
    summary: null,
    hasEmbedding: false,
    embeddingStrategy: null,
  };
}

export interface GmailService {
  getAuthUrl(): string;
  handleCallback(code: string): Promise<string>; // returns authenticated email address
  isAuthenticated(): Promise<boolean>;
  getAuthenticatedEmail(): Promise<string | null>;
  revokeToken(): Promise<void>;
  fetchMessagesSince(date: string | null, maxResults: number): Promise<Email[]>;
  fetchMessagesBefore(date: string, maxResults: number): Promise<Email[]>;
  fetchMessagesInRange(newerThan: string, olderThan: string, maxResults: number): Promise<Email[]>;
  archiveMessage(messageId: string): Promise<void>;
  deleteMessage(messageId: string): Promise<void>;
}

export function createGmailService(clientId: string, clientSecret: string, redirectUri: string): GmailService {
  const oauth2Client = new OAuth2Client(clientId, clientSecret, redirectUri);

  async function loadTokens(): Promise<boolean> {
    try {
      const raw = await fs.readFile(getTokensPath(), 'utf-8');
      oauth2Client.setCredentials(JSON.parse(raw));
      return true;
    } catch {
      return false;
    }
  }

  async function saveTokens(): Promise<void> {
    const tokens = oauth2Client.credentials;
    const dir = path.dirname(getTokensPath());
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(getTokensPath(), JSON.stringify(tokens, null, 2));
  }

  return {
    getAuthUrl() {
      return oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: ['https://www.googleapis.com/auth/gmail.modify'],
        prompt: 'consent',
      });
    },

    async handleCallback(code) {
      const { tokens } = await oauth2Client.getToken(code);
      oauth2Client.setCredentials(tokens);
      await saveTokens();

      const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
      const profile = await gmail.users.getProfile({ userId: 'me' });
      return profile.data.emailAddress ?? '';
    },

    async isAuthenticated() {
      return loadTokens();
    },

    async getAuthenticatedEmail() {
      const ok = await loadTokens();
      if (!ok) return null;
      try {
        const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
        const profile = await gmail.users.getProfile({ userId: 'me' });
        return profile.data.emailAddress ?? null;
      } catch {
        return null;
      }
    },

    async revokeToken() {
      await loadTokens();
      await oauth2Client.revokeCredentials();
      await fs.rm(getTokensPath(), { force: true });
    },

    async fetchMessagesSince(date, maxResults) {
      await loadTokens();
      const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
      const query = date ? `after:${Math.floor(new Date(date).getTime() / 1000)}` : '';

      const listRes = await gmail.users.messages.list({
        userId: 'me', q: query, maxResults,
      });

      const messages = listRes.data.messages ?? [];
      const emails: Email[] = [];

      for (const msg of messages) {
        const detail = await gmail.users.messages.get({
          userId: 'me', id: msg.id!, format: 'full',
        });
        emails.push(messageToEmail(detail.data as GmailMessage));
      }

      return emails;
    },

    async fetchMessagesBefore(date, maxResults) {
      await loadTokens();
      const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
      const before = Math.floor(new Date(date).getTime() / 1000);
      const query = `before:${before}`;

      const listRes = await gmail.users.messages.list({ userId: 'me', q: query, maxResults });
      const messages = listRes.data.messages ?? [];
      const emails: Email[] = [];

      for (const msg of messages) {
        const detail = await gmail.users.messages.get({ userId: 'me', id: msg.id!, format: 'full' });
        emails.push(messageToEmail(detail.data as GmailMessage));
      }

      return emails;
    },

    async fetchMessagesInRange(newerThan, olderThan, maxResults) {
      await loadTokens();
      const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
      const after = Math.floor(new Date(olderThan).getTime() / 1000);
      const before = Math.floor(new Date(newerThan).getTime() / 1000);
      const query = `after:${after} before:${before}`;

      const listRes = await gmail.users.messages.list({ userId: 'me', q: query, maxResults });
      const messages = listRes.data.messages ?? [];
      const emails: Email[] = [];

      for (const msg of messages) {
        const detail = await gmail.users.messages.get({ userId: 'me', id: msg.id!, format: 'full' });
        emails.push(messageToEmail(detail.data as GmailMessage));
      }

      return emails;
    },

    async archiveMessage(messageId) {
      await loadTokens();
      const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
      await gmail.users.messages.modify({
        userId: 'me',
        id: messageId,
        requestBody: { removeLabelIds: ['INBOX'] },
      });
    },

    async deleteMessage(messageId) {
      await loadTokens();
      const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
      await gmail.users.messages.trash({ userId: 'me', id: messageId });
    },
  };
}
