export interface StatusResponse {
  status: string;
  version: string;
  database: string;
}

export interface EmailSummary {
  id: string;
  sender: string;
  subject: string;
  date_received: number;
  is_read: boolean;
  is_starred: boolean;
}

export interface EmailDetail {
  id: string;
  thread_id: string;
  sender: string;
  recipients: string[];
  subject: string;
  body_text: string;
  body_html: string;
  date_sent: number;
  date_received: number;
  labels: { id: string; name: string }[];
  is_read: boolean;
  is_starred: boolean;
  summary: string | null;
}

export interface EmailListResponse {
  emails: EmailSummary[];
  total: number;
}

export interface SearchResponse {
  results: SearchResult[];
  total: number;
}

export interface SearchResult {
  id: string;
  thread_id: string;
  sender: string;
  recipients: string;
  subject: string;
  date_received: number;
  is_read: boolean;
  is_starred: boolean;
  summary: string | null;
  score: number | null;
}

export class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  async getStatus(): Promise<StatusResponse> {
    const res = await fetch(`${this.baseUrl}/status`);
    if (!res.ok) {
      throw new Error(`Status check failed: ${res.status}`);
    }
    return res.json();
  }

  async getAuthStatus(): Promise<{ authorized: boolean }> {
    const res = await fetch(`${this.baseUrl}/auth/status`);
    if (!res.ok) {
      throw new Error(`Auth status check failed: ${res.status}`);
    }
    return res.json();
  }

  async getEmails(params?: {
    limit?: number;
    offset?: number;
    unread?: boolean;
    label?: string;
  }): Promise<EmailListResponse> {
    const searchParams = new URLSearchParams();
    if (params?.limit) searchParams.set("limit", String(params.limit));
    if (params?.offset) searchParams.set("offset", String(params.offset));
    if (params?.unread !== undefined)
      searchParams.set("unread", String(params.unread));
    if (params?.label) searchParams.set("label", params.label);

    const qs = searchParams.toString();
    const url = `${this.baseUrl}/emails${qs ? `?${qs}` : ""}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Get emails failed: ${res.status}`);
    return res.json();
  }

  async getEmail(id: string): Promise<EmailDetail> {
    const res = await fetch(`${this.baseUrl}/emails/${id}`);
    if (!res.ok) throw new Error(`Get email failed: ${res.status}`);
    return res.json();
  }

  async triggerSync(batchSize?: number): Promise<{ status: string }> {
    const qs = batchSize ? `?batchSize=${batchSize}` : "";
    const res = await fetch(`${this.baseUrl}/sync${qs}`, { method: "POST" });
    if (!res.ok) throw new Error(`Sync failed: ${res.status}`);
    return res.json();
  }

  async getSyncStatus(): Promise<{
    totalEmails: number;
    unreadCount: number;
    lastHistoryId: string | null;
    syncInProgress: boolean;
    gapCount: number;
  }> {
    const res = await fetch(`${this.baseUrl}/sync/status`);
    if (!res.ok) throw new Error(`Sync status failed: ${res.status}`);
    return res.json();
  }

  async archiveEmail(id: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/emails/${id}/archive`, {
      method: "POST",
    });
    if (!res.ok) throw new Error(`Archive failed: ${res.status}`);
  }

  async deleteEmail(id: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/emails/${id}/delete`, {
      method: "POST",
    });
    if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
  }

  async markRead(id: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/emails/${id}/read`, {
      method: "POST",
    });
    if (!res.ok) throw new Error(`Mark read failed: ${res.status}`);
  }

  async markUnread(id: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/emails/${id}/unread`, {
      method: "POST",
    });
    if (!res.ok) throw new Error(`Mark unread failed: ${res.status}`);
  }

  async search(query: string, limit?: number): Promise<SearchResponse> {
    const qs = limit ? `?limit=${limit}` : "";
    const res = await fetch(`${this.baseUrl}/search${qs}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    if (!res.ok) throw new Error(`Search failed: ${res.status}`);
    return res.json();
  }
}
