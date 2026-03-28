import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { createApiClient } from './api.js';
import type { Email, SyncResult } from '@gmail-sweep/shared';

const BASE = 'http://localhost:3141';
const api = createApiClient(BASE);

function mockOk(body: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: async () => body });
}
function mockErr(status: number) {
  return Promise.resolve({ ok: false, status, json: async () => ({ error: 'fail' }) });
}

describe('api client', () => {
  beforeEach(() => mockFetch.mockReset());

  it('listEmails calls GET /emails', async () => {
    mockFetch.mockReturnValue(mockOk({ emails: [] }));
    await api.listEmails({});
    expect(mockFetch).toHaveBeenCalledWith(`${BASE}/emails`, expect.any(Object));
  });

  it('listEmails passes query params', async () => {
    mockFetch.mockReturnValue(mockOk({ emails: [] }));
    await api.listEmails({ sender: 'alice@example.com', limit: 50 });
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('sender=alice%40example.com');
    expect(url).toContain('limit=50');
  });

  it('listEmails includes anchor_unsummarized=true in query string when set', async () => {
    const emails: Email[] = [];
    mockFetch.mockReturnValue(mockOk({ emails }));

    await api.listEmails({ anchor_unsummarized: true, limit: 200 });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('anchor_unsummarized=true'),
      expect.any(Object)
    );
  });

  it('getEmail calls GET /emails/:id', async () => {
    const email = { id: 'msg1' } as Email;
    mockFetch.mockReturnValue(mockOk(email));
    const result = await api.getEmail('msg1');
    expect(mockFetch).toHaveBeenCalledWith(`${BASE}/emails/msg1`, expect.any(Object));
    expect(result.id).toBe('msg1');
  });

  it('getSummary calls GET /emails/:id/summary', async () => {
    mockFetch.mockReturnValue(mockOk({ description: 'Test', actionItems: [], keyPoints: [] }));
    await api.getSummary('msg1');
    expect(mockFetch).toHaveBeenCalledWith(`${BASE}/emails/msg1/summary`, expect.any(Object));
  });

  it('archiveEmail calls POST /emails/:id/archive without Content-Type header', async () => {
    mockFetch.mockReturnValue(mockOk({}));
    await api.archiveEmail('msg1');
    const init = mockFetch.mock.calls[0][1] as RequestInit & { headers: Record<string, string> };
    expect(mockFetch).toHaveBeenCalledWith(`${BASE}/emails/msg1/archive`, expect.objectContaining({ method: 'POST' }));
    expect(init.headers['Content-Type']).toBeUndefined();
  });

  it('deleteEmail calls POST /emails/:id/delete without Content-Type header', async () => {
    mockFetch.mockReturnValue(mockOk({}));
    await api.deleteEmail('msg1');
    const init = mockFetch.mock.calls[0][1] as RequestInit & { headers: Record<string, string> };
    expect(mockFetch).toHaveBeenCalledWith(`${BASE}/emails/msg1/delete`, expect.objectContaining({ method: 'POST' }));
    expect(init.headers['Content-Type']).toBeUndefined();
  });

  it('sync sends Content-Type: application/json when body is present', async () => {
    const result: SyncResult = { fetched: 0, newEmails: 0, gapsFilled: 0, olderFetched: 0, remainingGaps: [] };
    mockFetch.mockReturnValue(mockOk(result));
    await api.sync(500);
    const init = mockFetch.mock.calls[0][1] as RequestInit & { headers: Record<string, string> };
    expect(init.headers['Content-Type']).toBe('application/json');
  });

  it('sync calls POST /sync with batchSize', async () => {
    const result: SyncResult = { fetched: 10, newEmails: 5, gapsFilled: 0, olderFetched: 0, remainingGaps: [] };
    mockFetch.mockReturnValue(mockOk(result));
    const r = await api.sync(500);
    expect(mockFetch).toHaveBeenCalledWith(
      `${BASE}/sync`,
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ batchSize: 500 }) }),
    );
    expect(r.fetched).toBe(10);
  });

  it('search calls POST /search', async () => {
    mockFetch.mockReturnValue(mockOk({ emails: [], scores: [] }));
    await api.search('emails about deadlines');
    expect(mockFetch).toHaveBeenCalledWith(
      `${BASE}/search`,
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('throws on non-ok response', async () => {
    mockFetch.mockReturnValue(mockErr(404));
    await expect(api.getEmail('bad')).rejects.toThrow('HTTP 404');
  });

  it('getSummarizerStatus fetches /summarizer/status', async () => {
    mockFetch.mockReturnValue(mockOk({ status: 'running', processed: 2, pending: 3 }));
    const result = await api.getSummarizerStatus();
    expect(result.status).toBe('running');
    expect(result.processed).toBe(2);
    expect(result.pending).toBe(3);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3141/summarizer/status',
      expect.objectContaining({ headers: expect.objectContaining({ 'Accept-Encoding': 'identity' }) })
    );
  });
});
