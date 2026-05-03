import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import "../../packages/shared/src";
import type {
  AiConfig,
  ApiRequest,
  ApiResponse,
  BackfillJobStatus,
  Email,
  EmailSummary,
  GmailProviderMode,
  AiProviderMode,
  ProviderMode,
  SearchQuery,
  SyncStatus,
} from "../../packages/shared/src";

function expectSharedTypesToCompile(source: string) {
  const dir = mkdtempSync(join(tmpdir(), "gmail-sweep-shared-types-"));
  const file = join(dir, "assertions.ts");
  writeFileSync(file, source);

  const result = spawnSync(
    join(process.cwd(), "node_modules/.bin/tsc"),
    [
      "--noEmit",
      "--strict",
      "--target",
      "ES2022",
      "--module",
      "ESNext",
      "--moduleResolution",
      "bundler",
      "--skipLibCheck",
      file,
    ],
    { encoding: "utf8" },
  );

  rmSync(dir, { recursive: true, force: true });
  expect(result.status, result.stderr || result.stdout || result.error?.message).toBe(0);
}

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
  const mode: ProviderMode = "google";
  const query: SearchQuery = { text: "invoice", from: "sender@example.com", has: ["attachment"], labelIds: ["INBOX"] };
  const request: ApiRequest = { type: "searchEmails", query, limit: 20 };
  const response: ApiResponse = { type: "searchEmails", emails: [], nextPageToken: null };

  expect(mode).toBe("google");
  expect(request.query.has?.[0]).toBe("attachment");
  expect(response.nextPageToken).toBeNull();
});

test("shared types expose v1 status, auth, account, sync, backfill, and summary request contracts", () => {
  expectSharedTypesToCompile(`
    import type { ApiRequest } from "${process.cwd()}/packages/shared/src";

    const requests: ApiRequest[] = [
      { type: "getStatus" },
      { type: "getAuthStatus" },
      { type: "startAuth" },
      { type: "authCallback", code: "code-1", state: "state-1" },
      { type: "listAccounts" },
      { type: "setActiveAccount", accountId: "account-1" },
      { type: "getSyncStatus" },
      { type: "getBackfillStatus" },
      { type: "getSummariesStatus" },
    ];

    requests satisfies ApiRequest[];
  `);
});

test("shared types keep Gmail and AI provider modes separate", () => {
  const gmailProvider: GmailProviderMode = "google";
  const fakeGmailProvider: GmailProviderMode = "fake";
  const aiProvider: AiProviderMode = "openai";
  const aiConfig: AiConfig = { provider: "anthropic", model: "claude" };
  const fakeAiConfig: AiConfig = { provider: "fake", model: "fake-summary" };

  expect(gmailProvider).toBe("google");
  expect(fakeGmailProvider).toBe("fake");
  expect(aiProvider).toBe("openai");
  expect(aiConfig.provider).toBe("anthropic");
  expect(fakeAiConfig.provider).toBe("fake");

  expectSharedTypesToCompile(`
    import type { AiConfig } from "${process.cwd()}/packages/shared/src";

    // @ts-expect-error AiConfig.provider must not accept the Gmail provider.
    const badConfig: AiConfig = { provider: "gmail", model: "mail-model" };

    void badConfig;
  `);
});

test("shared types expose bad plain-text fallback body audit reason", () => {
  const email: Pick<Email, "bodyAudit"> = {
    bodyAudit: { source: "text/html", reason: "html-fallback" },
  };

  expect(email.bodyAudit.reason).toBe("html-fallback");
});
