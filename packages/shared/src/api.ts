import type { Email } from "./email";
import type { ProviderProbeResponse } from "./provider";
import type { SearchQuery } from "./search";
import type {
  BackfillJobStatus,
  StartBackfillRequest,
  StartBackfillResponse,
  SyncStatus,
} from "./sync";

export type EmailMutation =
  | "archive"
  | "trash"
  | "read"
  | "unread"
  | "star"
  | "unstar"
  | "important"
  | "unimportant";

export type ApiRequest =
  | { type: "getStatus" }
  | { type: "getAuthStatus" }
  | { type: "startAuth" }
  | { type: "authCallback"; code: string; state?: string }
  | { type: "listAccounts" }
  | { type: "setActiveAccount"; accountId: string }
  | { type: "startSync" }
  | { type: "getSyncStatus" }
  | StartBackfillRequest & { type: "startBackfill" }
  | { type: "getBackfillStatus" }
  | { type: "listEmails"; limit?: number; pageToken?: string | null }
  | { type: "getEmail"; id: string }
  | { type: "mutateEmail"; id: string; mutation: EmailMutation }
  | { type: "getSummary"; id: string }
  | { type: "createSummary"; id: string }
  | { type: "getSummariesStatus" }
  | { type: "searchEmails"; query: SearchQuery; limit?: number }
  | { type: "probeProvider"; provider: "gmail" | "ai" };

export type ApiResponse =
  | { type: "syncStatus"; status: SyncStatus }
  | ({ type: "startBackfill" } & StartBackfillResponse)
  | { type: "backfillStatus"; active: BackfillJobStatus[]; recent: BackfillJobStatus[] }
  | { type: "listEmails"; emails: Email[]; nextPageToken: string | null }
  | { type: "getEmail"; email: Email | null }
  | { type: "mutateEmail"; email: Email }
  | { type: "getSummary"; summary: Email["summary"]; summaryStatus: Email["summaryStatus"] }
  | { type: "searchEmails"; emails: Email[]; nextPageToken: string | null }
  | { type: "probeProvider"; result: ProviderProbeResponse }
  | { type: "error"; message: string };
