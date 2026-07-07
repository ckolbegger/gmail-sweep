import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// Point config/db paths at a temp dir
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof os>();
  return { ...actual, homedir: vi.fn() };
});

// Stub the AI service so no network calls happen
vi.mock('./services/ai.js', () => ({
  createAiService: vi.fn(() => ({
    summarizeEmail: vi.fn().mockResolvedValue({
      description: 'stub summary', actionItems: [], keyPoints: [],
    }),
    parseSearchQuery: vi.fn(),
  })),
}));

import { buildServer } from './server.js';
import { createDb } from './services/db.js';

describe('buildServer', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gmail-sweep-server-test-'));
    vi.mocked(os.homedir).mockReturnValue(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('resumes pending summaries on startup without waiting for a sync', async () => {
    // Seed a DB with an unsummarised email before the server boots
    const dbPath = path.join(tmpDir, 'emails.db');
    const seed = createDb(dbPath);
    seed.upsertEmail({ id: 'e1', threadId: 't1', subject: 'Hi', from: 'a@b.com',
      date: '2026-03-01T00:00:00Z', snippet: '', bodyText: 'body', bodyHtml: null,
      labels: ['INBOX'], summary: null });

    const app = await buildServer({ dbPath });
    try {
      // Poll until the background summarizer catches up
      const deadline = Date.now() + 5000;
      let summary: unknown = null;
      while (Date.now() < deadline) {
        summary = seed.getEmail('e1')?.summary ?? null;
        if (summary) break;
        await new Promise(r => setTimeout(r, 50));
      }
      expect(summary).toEqual({ description: 'stub summary', actionItems: [], keyPoints: [] });
    } finally {
      await app.close();
    }
  });
});
