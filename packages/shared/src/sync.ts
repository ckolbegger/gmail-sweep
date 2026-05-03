export type SyncMode =
  | "idle"
  | "syncing"
  | "hydrating"
  | "backfilling"
  | "paused"
  | "error";

export interface SyncStatus {
  mode: SyncMode;
  totalMessages: number;
  pendingHydration: number;
  pendingHistory: number;
  stale: boolean;
}

export type BackfillScope =
  | { type: "inbox" }
  | { type: "allMail" }
  | { type: "unread" }
  | { type: "starred" }
  | { type: "label"; labelId: string };

export type BackfillStatus =
  | "queued"
  | "discovering"
  | "hydrating"
  | "complete"
  | "blocked"
  | "failed";

export interface BackfillWindow {
  olderThan: string;
  newerThanOrEqual: string;
}

export interface StartBackfillRequest {
  scope: BackfillScope;
  days?: number;
}

export type StartBackfillResponse =
  | {
      ok: true;
      jobId: string;
      status: Exclude<BackfillStatus, "blocked" | "failed">;
      scope: BackfillScope;
      window: BackfillWindow;
      maxMessagesPerFetch: number;
    }
  | {
      ok: false;
      status: "blocked" | "failed";
      reason: string;
      scope: BackfillScope;
    };

export interface BackfillJobStatus {
  jobId: string;
  status: BackfillStatus;
  scope: BackfillScope;
  window: BackfillWindow;
  discovered: number;
  hydrated: number;
  pending: number;
  reason?: string;
}
