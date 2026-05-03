import { describe, expect, test } from "bun:test";
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
  GmailConfig,
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

test("shared types expose successful API response variants for every request family", () => {
  expectSharedTypesToCompile(`
    import type { ApiResponse, Email } from "${process.cwd()}/packages/shared/src";

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
      labels: ["INBOX"],
      system: { unread: false, inbox: true, trash: false, spam: false, sent: false, draft: false, starred: false, important: false, category: null },
      userLabels: [],
      bodyText: "body",
      bodyHtml: null,
      bodyAudit: { source: "text/plain", reason: "plain-text-present" },
      summary: null,
      summaryStatus: "missing",
    };

    const responsesByRequestFamily = {
      getStatus: { type: "status", ok: true, version: "0.1.0", providerMode: "google", activeAccountId: "account-1" },
      getAuthStatus: { type: "authStatus", authenticated: true, activeAccountId: "account-1" },
      startAuth: { type: "startAuth", authUrl: "http://localhost/auth" },
      authCallback: { type: "authCallback", ok: true, activeAccountId: "account-1" },
      listAccounts: { type: "listAccounts", accounts: [{ id: "account-1", email: "me@example.com", displayName: "Me" }], activeAccountId: "account-1" },
      setActiveAccount: { type: "setActiveAccount", activeAccountId: "account-1" },
      startSync: { type: "startSync", status: { mode: "syncing", totalMessages: 0, pendingHydration: 0, pendingHistory: 0, stale: false } },
      getSyncStatus: { type: "syncStatus", status: { mode: "idle", totalMessages: 0, pendingHydration: 0, pendingHistory: 0, stale: false } },
      startBackfill: { type: "startBackfill", ok: true, jobId: "job-1", status: "queued", scope: { type: "inbox" }, window: { olderThan: "2026-05-03T00:00:00.000Z", newerThanOrEqual: "2026-05-02T00:00:00.000Z" }, maxMessagesPerFetch: 100 },
      getBackfillStatus: { type: "backfillStatus", active: [], recent: [] },
      listEmails: { type: "listEmails", emails: [email], nextPageToken: null },
      getEmail: { type: "getEmail", email },
      mutateEmail: { type: "mutateEmail", email },
      getSummary: { type: "getSummary", summary: null, summaryStatus: "missing" },
      createSummary: { type: "createSummary", summaryStatus: "queued" },
      getSummariesStatus: { type: "summariesStatus", queued: 1, inProgress: 0, rateLimited: false },
      searchEmails: { type: "searchEmails", emails: [email], nextPageToken: null },
      probeProvider: { type: "probeProvider", result: { provider: "google", status: "ok" } },
    } satisfies Record<string, ApiResponse>;

    void responsesByRequestFamily;
  `);
});

describe("shared provider contracts", () => {
  test("it should allow Gmail providers to be google or fakeGmail only", () => {
    const googleProvider: GmailProviderMode = "google";
    const fakeProvider: GmailProviderMode = "fakeGmail";
    const googleConfig: GmailConfig = { provider: "google" };
    const fakeConfig: GmailConfig = { provider: "fakeGmail" };

    expect(googleProvider).toBe("google");
    expect(fakeProvider).toBe("fakeGmail");
    expect(googleConfig.provider).toBe("google");
    expect(fakeConfig.provider).toBe("fakeGmail");
  });

  test("it should allow AI providers to be openai, anthropic, or fakeAI only", () => {
    const openaiProvider: AiProviderMode = "openai";
    const anthropicProvider: AiProviderMode = "anthropic";
    const fakeProvider: AiProviderMode = "fakeAI";
    const openaiConfig: AiConfig = { provider: "openai", model: "gpt-5" };
    const anthropicConfig: AiConfig = { provider: "anthropic", model: "claude" };
    const fakeConfig: AiConfig = { provider: "fakeAI", model: "fake-summary" };

    expect(openaiProvider).toBe("openai");
    expect(anthropicProvider).toBe("anthropic");
    expect(fakeProvider).toBe("fakeAI");
    expect(openaiConfig.provider).toBe("openai");
    expect(anthropicConfig.provider).toBe("anthropic");
    expect(fakeConfig.provider).toBe("fakeAI");
  });

  test("it should reject AI-only providers for Gmail config at type-check time", () => {
    // @ts-expect-error GmailConfig.provider must not accept the OpenAI provider.
    const openaiConfig: GmailConfig = { provider: "openai" };
    // @ts-expect-error GmailConfig.provider must not accept the Anthropic provider.
    const anthropicConfig: GmailConfig = { provider: "anthropic" };
    // @ts-expect-error GmailConfig.provider must not accept the old ambiguous fake provider.
    const fakeConfig: GmailConfig = { provider: "fake" };
    // @ts-expect-error GmailConfig.provider must not accept the AI fake provider.
    const fakeAiConfig: GmailConfig = { provider: "fakeAI" };

    void openaiConfig;
    void anthropicConfig;
    void fakeConfig;
    void fakeAiConfig;
  });

  test("it should reject Gmail-only providers for AI config at type-check time", () => {
    // @ts-expect-error AiConfig.provider must not accept the Gmail provider.
    const gmailConfig: AiConfig = { provider: "gmail", model: "mail-model" };
    // @ts-expect-error AiConfig.provider must not accept the Google provider.
    const googleConfig: AiConfig = { provider: "google", model: "mail-model" };
    // @ts-expect-error AiConfig.provider must not accept the old ambiguous fake provider.
    const fakeConfig: AiConfig = { provider: "fake", model: "fake-summary" };
    // @ts-expect-error AiConfig.provider must not accept the Gmail fake provider.
    const fakeGmailConfig: AiConfig = { provider: "fakeGmail", model: "fake-summary" };

    void gmailConfig;
    void googleConfig;
    void fakeConfig;
    void fakeGmailConfig;
  });
});

test("shared types expose bad plain-text fallback body audit reason", () => {
  const email: Pick<Email, "bodyAudit"> = {
    bodyAudit: { source: "text/html", reason: "html-fallback" },
  };

  expect(email.bodyAudit.reason).toBe("html-fallback");
});
