import type { Email, EmailSummary, EmailListParams, SyncResult, SearchResult, SummarizerStatus, AppConfig } from '@gmail-sweep/shared';

export interface ApiClient {
  listEmails(params: EmailListParams): Promise<{ emails: Email[] }>;
  getEmail(id: string): Promise<Email>;
  getSummary(id: string): Promise<EmailSummary>;
  archiveEmail(id: string): Promise<void>;
  deleteEmail(id: string): Promise<void>;
  sync(batchSize?: number): Promise<SyncResult>;
  search(query: string, limit?: number): Promise<SearchResult>;
  authStatus(): Promise<{ authenticated: boolean; email?: string }>;
  getSummarizerStatus(): Promise<SummarizerStatus>;
  getConfig(): Promise<AppConfig>;
}

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', 'Accept-Encoding': 'identity' },
    ...init,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.json() as Promise<T>;
}

export function createApiClient(base: string): ApiClient {
  return {
    listEmails(params) {
      const qs = new URLSearchParams();
      if (params.sender) qs.set('sender', params.sender);
      if (params.date_from) qs.set('date_from', params.date_from);
      if (params.date_to) qs.set('date_to', params.date_to);
      if (params.subject) qs.set('subject', params.subject);
      if (params.limit != null) qs.set('limit', String(params.limit));
      if (params.offset != null) qs.set('offset', String(params.offset));
      if (params.anchor_unsummarized) qs.set('anchor_unsummarized', 'true');
      const q = qs.toString();
      return request(`${base}/emails${q ? '?' + q : ''}`, {});
    },
    getEmail(id) { return request(`${base}/emails/${id}`, {}); },
    getSummary(id) { return request(`${base}/emails/${id}/summary`, {}); },
    archiveEmail(id) { return request(`${base}/emails/${id}/archive`, { method: 'POST' }); },
    deleteEmail(id) { return request(`${base}/emails/${id}/delete`, { method: 'POST' }); },
    sync(batchSize = 500) {
      return request(`${base}/sync`, {
        method: 'POST',
        body: JSON.stringify({ batchSize }),
      });
    },
    search(query, limit = 20) {
      return request(`${base}/search`, {
        method: 'POST',
        body: JSON.stringify({ query, limit }),
      });
    },
    authStatus() { return request(`${base}/auth/status`, {}); },
    getSummarizerStatus() { return request<SummarizerStatus>(`${base}/summarizer/status`, {}); },
    getConfig() { return request<AppConfig>(`${base}/config`, {}); },
  };
}
