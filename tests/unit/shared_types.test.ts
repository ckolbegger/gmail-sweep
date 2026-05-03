import { expect, test } from "bun:test";
import "../../packages/shared/src";
import type {
  ApiRequest,
  ApiResponse,
  BackfillJobStatus,
  Email,
  EmailSummary,
  ProviderMode,
  SearchQuery,
  SyncStatus,
} from "../../packages/shared/src";

test("shared types expose v1 email contract", () => {
  const summary: EmailSummary = { description: "d", actionItems: [], keyPoints: [] };
  const email: Email = {
    id: "m1",
    threadId: "t1",
    subject: "Subject",
    from: "sender@example.com",
    to: ["me@example.com"],
    cc: [],
    bcc: [],
    date: "2026-05-03T00:00:00.000Z",
    snippet: "snippet",
    labels: ["INBOX", "UNREAD"],
    system: { unread: true, inbox: true, trash: false, spam: false, sent: false, draft: false, starred: false, important: false, category: null },
    userLabels: [],
    bodyText: "body",
    bodyHtml: null,
    bodyAudit: { source: "text/plain", reason: "plain-text-present" },
    summary,
    summaryStatus: "complete"
  };
  const status: SyncStatus = { mode: "idle", totalMessages: 1, pendingHydration: 0, pendingHistory: 0, stale: false };
  expect(email.summary?.description).toBe("d");
  expect(status.stale).toBe(false);
});

test("shared types expose body audit and sync states", () => {
  const email: Pick<Email, "bodyAudit" | "summaryStatus"> = {
    bodyAudit: { source: "text/html", reason: "html-converted" },
    summaryStatus: "queued",
  };
  const status: SyncStatus = {
    mode: "backfilling",
    totalMessages: 10,
    pendingHydration: 2,
    pendingHistory: 1,
    stale: true,
  };
  const backfill: BackfillJobStatus = {
    jobId: "job-1",
    status: "hydrating",
    scope: { type: "inbox" },
    window: { olderThan: "2026-05-03T00:00:00.000Z", newerThanOrEqual: "2026-05-02T00:00:00.000Z" },
    discovered: 5,
    hydrated: 2,
    pending: 3,
  };

  expect(email.bodyAudit.source).toBe("text/html");
  expect(status.pendingHydration).toBe(2);
  expect(backfill.status).toBe("hydrating");
});

test("shared types expose API, provider, and search contracts", () => {
  const mode: ProviderMode = "gmail";
  const query: SearchQuery = { text: "invoice", from: "sender@example.com", has: ["attachment"], labelIds: ["INBOX"] };
  const request: ApiRequest = { type: "searchEmails", query, limit: 20 };
  const response: ApiResponse = { type: "searchEmails", emails: [], nextPageToken: null };

  expect(mode).toBe("gmail");
  expect(request.query.has?.[0]).toBe("attachment");
  expect(response.nextPageToken).toBeNull();
});
