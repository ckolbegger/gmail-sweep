import type {
  GmailAdapter,
  GmailLabel,
  GmailMessage,
  ListMessagesResult,
  HistoryRecord,
  ListHistoryResult,
} from "./adapter";

const BASE_URL = "https://gmail.googleapis.com";
const MAX_RETRIES = 3;

function decodeBase64(data: string): string {
  return Buffer.from(data, "base64").toString("utf-8");
}

function findHeader(headers: { name: string; value: string }[], name: string): string {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function extractBody(payload: any): { text: string; html: string } {
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return { text: decodeBase64(payload.body.data), html: "" };
  }
  if (payload.mimeType === "text/html" && payload.body?.data) {
    return { text: "", html: decodeBase64(payload.body.data) };
  }
  if (payload.parts) {
    let text = "";
    let html = "";
    for (const part of payload.parts) {
      const extracted = extractBody(part);
      text = text || extracted.text;
      html = html || extracted.html;
    }
    return { text, html };
  }
  return { text: "", html: "" };
}

export class GmailApiClient implements GmailAdapter {
  private getTokens: () => Promise<{ access_token: string } | null>;

  constructor(getTokens: () => Promise<{ access_token: string } | null>) {
    this.getTokens = getTokens;
  }

  private async request(path: string, opts: RequestInit = {}): Promise<Response> {
    const tokens = await this.getTokens();
    if (!tokens) throw new Error("Not authenticated");

    const url = `${BASE_URL}${path}`;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const res = await fetch(url, {
        ...opts,
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
          "Content-Type": "application/json",
          ...opts.headers,
        },
      });

      if (res.status === 401) {
        throw new Error("Authentication error: token invalid or expired");
      }

      if (res.status === 429 || res.status === 500 || res.status === 503) {
        if (attempt < MAX_RETRIES) {
          const delay = Math.pow(2, attempt) * 100;
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        throw new Error(`Gmail API error after retries: ${res.status}`);
      }

      return res;
    }

    throw new Error("Max retries exceeded");
  }

  async listMessages(params: {
    maxResults: number;
    pageToken?: string;
    labelIds?: string[];
  }): Promise<ListMessagesResult> {
    const searchParams = new URLSearchParams({
      maxResults: String(params.maxResults),
    });
    if (params.pageToken) searchParams.set("pageToken", params.pageToken);
    if (params.labelIds) {
      for (const label of params.labelIds) {
        searchParams.append("labelIds", label);
      }
    }

    const res = await this.request(
      `/gmail/v1/users/me/messages?${searchParams}`
    );
    const data = (await res.json()) as any;

    return {
      messages: (data.messages ?? []).map((m: any) => ({
        id: m.id,
        threadId: m.threadId,
      })),
      nextPageToken: data.nextPageToken,
      historyId: String(data.historyId ?? ""),
    };
  }

  async getMessage(id: string): Promise<GmailMessage | null> {
    const res = await this.request(
      `/gmail/v1/users/me/messages/${id}?format=full`
    );
    const data = (await res.json()) as any;

    const headers = data.payload?.headers ?? [];
    const { text, html } = extractBody(data.payload);
    const labelIds: string[] = data.labelIds ?? [];

    return {
      id: data.id,
      threadId: data.threadId,
      sender: findHeader(headers, "From"),
      recipients: findHeader(headers, "To").split(",").map((s) => s.trim()).filter(Boolean),
      subject: findHeader(headers, "Subject"),
      bodyText: text,
      bodyHtml: html,
      dateSent: new Date(findHeader(headers, "Date")).getTime(),
      dateReceived: data.internalDate ? Number(data.internalDate) : Date.now(),
      labels: labelIds.map((id) => ({ id, name: id })),
      isRead: !labelIds.includes("UNREAD"),
      isStarred: labelIds.includes("STARRED"),
    };
  }

  async archive(id: string): Promise<void> {
    await this.request(`/gmail/v1/users/me/messages/${id}/modify`, {
      method: "POST",
      body: JSON.stringify({ removeLabelIds: ["INBOX"] }),
    });
  }

  async delete(id: string): Promise<void> {
    await this.request(`/gmail/v1/users/me/messages/${id}/modify`, {
      method: "POST",
      body: JSON.stringify({ addLabelIds: ["TRASH"] }),
    });
  }

  async modifyLabels(
    id: string,
    params: { addLabelIds: string[]; removeLabelIds: string[] }
  ): Promise<void> {
    await this.request(`/gmail/v1/users/me/messages/${id}/modify`, {
      method: "POST",
      body: JSON.stringify(params),
    });
  }

  async listLabels(): Promise<GmailLabel[]> {
    const res = await this.request("/gmail/v1/users/me/labels");
    const data = (await res.json()) as any;
    return (data.labels ?? []).map((l: any) => ({ id: l.id, name: l.name }));
  }

  async listHistory(params: {
    startHistoryId: string;
  }): Promise<ListHistoryResult> {
    const res = await this.request(
      `/gmail/v1/users/me/history?startHistoryId=${params.startHistoryId}`
    );

    if (res.status === 404) {
      throw new Error("History ID expired");
    }

    const data = (await res.json()) as any;
    const history: HistoryRecord[] = (data.history ?? []).map((h: any) => ({
      id: String(h.id),
      messagesAdded: h.messagesAdded?.map((ma: any) => ({
        id: ma.message.id,
        threadId: ma.message.threadId,
      })),
      messagesDeleted: h.messagesDeleted?.map((md: any) => ({
        id: md.message.id,
        threadId: md.message.threadId,
      })),
      labelsChanged: h.labelsAdded?.map((la: any) => ({
        id: la.message.id,
        threadId: la.message.threadId,
        addedLabels: la.labelIds,
      })),
    }));

    return {
      history,
      historyId: String(data.historyId ?? ""),
    };
  }
}
