import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DbHandle } from './db.js';
import type { AiService } from './ai.js';

// Mock email-ops so getOrCreateSummary is controllable
vi.mock('./email-ops.js', () => ({
  getOrCreateSummary: vi.fn().mockResolvedValue({
    description: 'summary', actionItems: [], keyPoints: [],
  }),
}));

import { createSummarizerWorker } from './summarizer.js';
import { getOrCreateSummary } from './email-ops.js';

const mockEmail = {
  id: 'e1', threadId: 't1', subject: 'Hi', from: 'a@a.com',
  date: '2024-01-01T00:00:00.000Z', snippet: '', bodyText: 'body',
  bodyHtml: null, labels: [], summary: null,
};

function makeDb(emailSequence: (typeof mockEmail | null)[]): DbHandle {
  let callCount = 0;
  return {
    getNextEmailWithoutSummary: vi.fn(() => emailSequence[callCount++] ?? null),
    countEmailsWithoutSummary: vi.fn().mockReturnValue(emailSequence.filter(Boolean).length),
  } as unknown as DbHandle;
}

function makeAi(): AiService {
  return {
    summarizeEmail: vi.fn().mockResolvedValue({ description: 'd', actionItems: [], keyPoints: [] }),
    parseSearchQuery: vi.fn(),
  } as unknown as AiService;
}

describe('SummarizerWorker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getOrCreateSummary).mockResolvedValue({
      description: 'summary', actionItems: [], keyPoints: [],
    });
  });

  it('is idle with zero processed before trigger is called', () => {
    const worker = createSummarizerWorker(makeDb([null]), makeAi());
    const s = worker.getStatus();
    expect(s.status).toBe('idle');
    expect(s.processed).toBe(0);
  });

  it('processes all emails without summaries then stops', async () => {
    const db = makeDb([mockEmail, { ...mockEmail, id: 'e2' }, null]);
    const worker = createSummarizerWorker(db, makeAi());

    worker.trigger();
    // Drain the microtask/promise queue
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(vi.mocked(getOrCreateSummary)).toHaveBeenCalledTimes(2);
    const s = worker.getStatus();
    expect(s.status).toBe('idle');
    expect(s.processed).toBe(2);
  });

  it('reports status=running and increments processed mid-run', async () => {
    let resolveSummary!: () => void;
    vi.mocked(getOrCreateSummary).mockImplementationOnce(
      () => new Promise(resolve => { resolveSummary = () => resolve({ description: 'd', actionItems: [], keyPoints: [] }); })
    );
    const db = makeDb([mockEmail, null]);
    const worker = createSummarizerWorker(db, makeAi());

    worker.trigger();
    await new Promise(resolve => setTimeout(resolve, 0)); // let run() start

    expect(worker.getStatus().status).toBe('running');
    expect(worker.getStatus().processed).toBe(0); // not yet resolved

    resolveSummary();
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(worker.getStatus().status).toBe('idle');
    expect(worker.getStatus().processed).toBe(1);
  });

  it('does not start a second run if already running', async () => {
    // Make the first email's summary take a tick so the worker stays running
    vi.mocked(getOrCreateSummary).mockImplementationOnce(
      () => new Promise(resolve => setTimeout(() => resolve({ description: 'd', actionItems: [], keyPoints: [] }), 50))
    );
    const db = makeDb([mockEmail, null]);
    const worker = createSummarizerWorker(db, makeAi());

    worker.trigger();
    worker.trigger(); // second call — should be ignored

    await new Promise(resolve => setTimeout(resolve, 100));
    // getNextEmailWithoutSummary called once (for e1) then once more (returns null) = 2 total
    expect(db.getNextEmailWithoutSummary).toHaveBeenCalledTimes(2);
  });

  it('waits with exponential backoff on rate-limit errors', async () => {
    vi.useFakeTimers();

    const rateLimitError = Object.assign(new Error('rate limited'), { status: 429 });
    vi.mocked(getOrCreateSummary)
      .mockRejectedValueOnce(rateLimitError)
      .mockResolvedValueOnce({ description: 'd', actionItems: [], keyPoints: [] });

    // Return the same email twice (first attempt fails, second succeeds)
    const db = makeDb([mockEmail, mockEmail, null]);
    const worker = createSummarizerWorker(db, makeAi());

    worker.trigger();
    // Let the first attempt fail
    await vi.runAllTimersAsync();
    // Advance by the initial 2 s backoff
    await vi.advanceTimersByTimeAsync(2000);
    await vi.runAllTimersAsync();

    expect(vi.mocked(getOrCreateSummary)).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it('skips an email that causes a non-rate-limit error and does not loop', async () => {
    const nonRateLimitError = new Error('AI parse failure');
    vi.mocked(getOrCreateSummary)
      .mockRejectedValueOnce(nonRateLimitError)
      .mockResolvedValueOnce({ description: 'd', actionItems: [], keyPoints: [] });

    // Simulate DB always returning e1 (newest unsummarised): e1 fails, second call still returns e1
    const db = makeDb([mockEmail, mockEmail, null]);
    const worker = createSummarizerWorker(db, makeAi());

    worker.trigger();
    await new Promise(resolve => setTimeout(resolve, 50));

    // e1 failed → added to failedIds → next call returns e1 again → break
    // e2 never reached in this run (e1 is newest and always returned first)
    expect(getOrCreateSummary).toHaveBeenCalledTimes(1);
    expect(worker.getStatus().status).toBe('idle');
  });

  it('initialises pending count from DB at construction time', () => {
    const db = makeDb([mockEmail, null]);
    const worker = createSummarizerWorker(db, makeAi());
    expect(worker.getStatus().pending).toBe(1);
  });
});
