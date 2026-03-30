import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { GmailApiClient } from "@backend/gmail/gmail-api";

const mockTokens = {
  access_token: "at-test",
  refresh_token: "rt-test",
  expiry_date: Date.now() + 3600000,
};

function createClient() {
  return new GmailApiClient(() => Promise.resolve(mockTokens));
}

describe("Gmail API client", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("listMessages", () => {
    it("should call GET /gmail/v1/users/me/messages with maxResults", async () => {
      const client = createClient();
      globalThis.fetch = mock(async (url: string) => {
        const u = new URL(url);
        expect(u.pathname).toBe("/gmail/v1/users/me/messages");
        expect(u.searchParams.get("maxResults")).toBe("10");
        return new Response(
          JSON.stringify({
            messages: [{ id: "m1", threadId: "t1" }],
            historyId: "100",
          })
        );
      }) as any;

      const result = await client.listMessages({ maxResults: 10 });
      expect(result.messages).toHaveLength(1);
    });

    it("should include pageToken when provided", async () => {
      const client = createClient();
      globalThis.fetch = mock(async (url: string) => {
        const u = new URL(url);
        expect(u.searchParams.get("pageToken")).toBe("page2");
        return new Response(
          JSON.stringify({ messages: [], historyId: "100" })
        );
      }) as any;

      await client.listMessages({ maxResults: 10, pageToken: "page2" });
    });

    it("should return message list, nextPageToken, and historyId", async () => {
      const client = createClient();
      globalThis.fetch = mock(async () => {
        return new Response(
          JSON.stringify({
            messages: [{ id: "m1", threadId: "t1" }],
            nextPageToken: "next",
            historyId: "200",
          })
        );
      }) as any;

      const result = await client.listMessages({ maxResults: 10 });
      expect(result.messages).toHaveLength(1);
      expect(result.nextPageToken).toBe("next");
      expect(result.historyId).toBe("200");
    });

    it("should throw on 401 with a clear auth error", async () => {
      const client = createClient();
      globalThis.fetch = mock(async () => {
        return new Response("Unauthorized", { status: 401 });
      }) as any;

      await expect(client.listMessages({ maxResults: 10 })).rejects.toThrow(
        /auth/i
      );
    });

    it("should retry on 429 with exponential backoff", async () => {
      const client = createClient();
      let callCount = 0;
      globalThis.fetch = mock(async () => {
        callCount++;
        if (callCount === 1) {
          return new Response("Rate limited", { status: 429 });
        }
        return new Response(
          JSON.stringify({ messages: [], historyId: "100" })
        );
      }) as any;

      const result = await client.listMessages({ maxResults: 10 });
      expect(callCount).toBeGreaterThan(1);
    });

    it("should retry on 500/503 with exponential backoff", async () => {
      const client = createClient();
      let callCount = 0;
      globalThis.fetch = mock(async () => {
        callCount++;
        if (callCount <= 2) {
          return new Response("Server error", { status: 500 });
        }
        return new Response(
          JSON.stringify({ messages: [], historyId: "100" })
        );
      }) as any;

      await client.listMessages({ maxResults: 10 });
      expect(callCount).toBeGreaterThan(2);
    });
  });

  describe("getMessage", () => {
    it("should call GET /gmail/v1/users/me/messages/{id} with format=full", async () => {
      const client = createClient();
      globalThis.fetch = mock(async (url: string) => {
        const u = new URL(url);
        expect(u.pathname).toBe("/gmail/v1/users/me/messages/msg1");
        expect(u.searchParams.get("format")).toBe("full");
        return new Response(
          JSON.stringify({
            id: "msg1",
            threadId: "t1",
            payload: {
              headers: [
                { name: "From", value: "alice@example.com" },
                { name: "To", value: "bob@example.com" },
                { name: "Subject", value: "Hello" },
                { name: "Date", value: "Mon, 1 Jan 2024 00:00:00 +0000" },
              ],
              mimeType: "text/plain",
              body: { data: btoa("Hello world") },
            },
            labelIds: ["INBOX"],
          })
        );
      }) as any;

      const msg = await client.getMessage("msg1");
      expect(msg).not.toBeNull();
      expect(msg!.id).toBe("msg1");
      expect(msg!.subject).toBe("Hello");
    });

    it("should parse numeric internalDate for dateReceived", async () => {
      const client = createClient();
      const expectedTimestamp = 1743290698000;
      globalThis.fetch = mock(async () => {
        return new Response(
          JSON.stringify({
            id: "msg1",
            threadId: "t1",
            internalDate: expectedTimestamp,
            payload: {
              headers: [
                { name: "From", value: "a@b.com" },
                { name: "To", value: "c@d.com" },
                { name: "Subject", value: "Test" },
                { name: "Date", value: "Mon, 01 Jan 2024 00:00:00 +0000" },
              ],
              mimeType: "text/plain",
              body: { data: btoa("Hello") },
            },
            labelIds: ["INBOX"],
          })
        );
      }) as any;

      const msg = await client.getMessage("msg1");
      expect(msg!.dateReceived).toBe(expectedTimestamp);
    });

    it("should fall back to Date header when internalDate is missing", async () => {
      const client = createClient();
      globalThis.fetch = mock(async () => {
        return new Response(
          JSON.stringify({
            id: "msg1",
            threadId: "t1",
            payload: {
              headers: [
                { name: "From", value: "a@b.com" },
                { name: "To", value: "c@d.com" },
                { name: "Subject", value: "Test" },
                { name: "Date", value: "Sat, 29 Mar 2025 12:00:00 +0000" },
              ],
              mimeType: "text/plain",
              body: { data: btoa("Hello") },
            },
            labelIds: ["INBOX"],
          })
        );
      }) as any;

      const msg = await client.getMessage("msg1");
      expect(msg!.dateReceived).toBeGreaterThan(0);
      expect(msg!.dateReceived).not.toBe(-2147483648);
    });

    it("should fall back to Date header when internalDate is not a valid number", async () => {
      const client = createClient();
      globalThis.fetch = mock(async () => {
        return new Response(
          JSON.stringify({
            id: "msg1",
            threadId: "t1",
            internalDate: "not-a-number",
            payload: {
              headers: [
                { name: "From", value: "a@b.com" },
                { name: "To", value: "c@d.com" },
                { name: "Subject", value: "Test" },
                { name: "Date", value: "Sat, 29 Mar 2025 12:00:00 +0000" },
              ],
              mimeType: "text/plain",
              body: { data: btoa("Hello") },
            },
            labelIds: ["INBOX"],
          })
        );
      }) as any;

      const msg = await client.getMessage("msg1");
      expect(Number.isNaN(msg!.dateReceived)).toBe(false);
      expect(msg!.dateReceived).toBeGreaterThan(0);
    });

    it("should extract text/plain and text/html body parts", async () => {
      const client = createClient();
      globalThis.fetch = mock(async () => {
        return new Response(
          JSON.stringify({
            id: "msg1",
            threadId: "t1",
            payload: {
              headers: [
                { name: "From", value: "a@b.com" },
                { name: "To", value: "c@d.com" },
                { name: "Subject", value: "Test" },
                { name: "Date", value: "Mon, 1 Jan 2024 00:00:00 +0000" },
              ],
              mimeType: "multipart/alternative",
              parts: [
                {
                  mimeType: "text/plain",
                  body: { data: btoa("plain text") },
                },
                {
                  mimeType: "text/html",
                  body: { data: btoa("<b>html</b>") },
                },
              ],
            },
            labelIds: ["INBOX"],
          })
        );
      }) as any;

      const msg = await client.getMessage("msg1");
      expect(msg!.bodyText).toBe("plain text");
      expect(msg!.bodyHtml).toBe("<b>html</b>");
    });
  });

  describe("archive", () => {
    it("should call POST modify removing INBOX label", async () => {
      const client = createClient();
      let requestBody: any;
      globalThis.fetch = mock(async (url: string, opts: any) => {
        const u = new URL(url);
        expect(u.pathname).toBe("/gmail/v1/users/me/messages/msg1/modify");
        requestBody = JSON.parse(opts.body);
        return new Response(JSON.stringify({}));
      }) as any;

      await client.archive("msg1");
      expect(requestBody.removeLabelIds).toContain("INBOX");
    });
  });

  describe("delete", () => {
    it("should call POST modify adding TRASH label", async () => {
      const client = createClient();
      let requestBody: any;
      globalThis.fetch = mock(async (url: string, opts: any) => {
        requestBody = JSON.parse(opts.body);
        return new Response(JSON.stringify({}));
      }) as any;

      await client.delete("msg1");
      expect(requestBody.addLabelIds).toContain("TRASH");
    });
  });

  describe("modifyLabels", () => {
    it("should call POST modify with add and remove label lists", async () => {
      const client = createClient();
      let requestBody: any;
      globalThis.fetch = mock(async (url: string, opts: any) => {
        requestBody = JSON.parse(opts.body);
        return new Response(JSON.stringify({}));
      }) as any;

      await client.modifyLabels("msg1", {
        addLabelIds: ["STARRED"],
        removeLabelIds: ["UNREAD"],
      });
      expect(requestBody.addLabelIds).toContain("STARRED");
      expect(requestBody.removeLabelIds).toContain("UNREAD");
    });
  });

  describe("listLabels", () => {
    it("should call GET labels and return label list", async () => {
      const client = createClient();
      globalThis.fetch = mock(async (url: string) => {
        const u = new URL(url);
        expect(u.pathname).toBe("/gmail/v1/users/me/labels");
        return new Response(
          JSON.stringify({
            labels: [
              { id: "INBOX", name: "INBOX" },
              { id: "TRASH", name: "TRASH" },
            ],
          })
        );
      }) as any;

      const labels = await client.listLabels();
      expect(labels).toHaveLength(2);
    });
  });

  describe("listHistory", () => {
    it("should call GET history with startHistoryId", async () => {
      const client = createClient();
      globalThis.fetch = mock(async (url: string) => {
        const u = new URL(url);
        expect(u.pathname).toBe("/gmail/v1/users/me/history");
        expect(u.searchParams.get("startHistoryId")).toBe("50");
        return new Response(
          JSON.stringify({
            history: [
              {
                id: "100",
                messagesAdded: [{ message: { id: "m1", threadId: "t1" } }],
              },
            ],
            historyId: "200",
          })
        );
      }) as any;

      const result = await client.listHistory({ startHistoryId: "50" });
      expect(result.history).toHaveLength(1);
      expect(result.historyId).toBe("200");
    });

    it("should throw on 404 when historyId has expired", async () => {
      const client = createClient();
      globalThis.fetch = mock(async () => {
        return new Response("Not found", { status: 404 });
      }) as any;

      await expect(
        client.listHistory({ startHistoryId: "expired" })
      ).rejects.toThrow();
    });
  });
});
