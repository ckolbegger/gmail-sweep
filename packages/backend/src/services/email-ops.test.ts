import { describe, it, expect, vi } from 'vitest';
import { getOrCreateSummary } from './email-ops.js';
import type { DbHandle } from './db.js';
import type { AiService } from './ai.js';
import type { Email, EmailSummary } from '@gmail-sweep/shared';

const makeEmail = (overrides: Partial<Email> = {}): Email => ({
  id: 'msg1', threadId: 't1', subject: 'Test', from: 'a@b.com',
  date: '2026-03-01T00:00:00Z', snippet: '', bodyText: 'Hello world',
  bodyHtml: null, labels: [], summary: null, hasEmbedding: false,
  embeddingStrategy: null, ...overrides,
});

const mockSummary: EmailSummary = {
  description: 'A test email',
  actionItems: [],
  keyPoints: ['hello'],
};

describe('getOrCreateSummary', () => {
  it('returns null when email does not exist', async () => {
    const db = { getEmail: vi.fn().mockReturnValue(null) } as unknown as DbHandle;
    const ai = {} as AiService;

    const result = await getOrCreateSummary(db, ai, 'nonexistent');
    expect(result).toBeNull();
  });

  it('returns existing summary without calling AI', async () => {
    const emailWithSummary = makeEmail({ summary: mockSummary });
    const db = { getEmail: vi.fn().mockReturnValue(emailWithSummary) } as unknown as DbHandle;
    const ai = { summarizeEmail: vi.fn() } as unknown as AiService;

    const result = await getOrCreateSummary(db, ai, 'msg1');

    expect(result).toEqual(mockSummary);
    expect(ai.summarizeEmail).not.toHaveBeenCalled();
  });

  it('generates and stores summary when none exists', async () => {
    const email = makeEmail({ summary: null });
    const updateSummary = vi.fn();
    const db = {
      getEmail: vi.fn().mockReturnValue(email),
      updateSummary,
    } as unknown as DbHandle;
    const ai = { summarizeEmail: vi.fn().mockResolvedValue(mockSummary) } as unknown as AiService;

    const result = await getOrCreateSummary(db, ai, 'msg1');

    expect(ai.summarizeEmail).toHaveBeenCalledWith('Hello world');
    expect(updateSummary).toHaveBeenCalledWith('msg1', mockSummary);
    expect(result).toEqual(mockSummary);
  });
});
