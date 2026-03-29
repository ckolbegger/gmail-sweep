import { Hono } from "hono";
import { createStatusRouter } from "./routes/status";
import { createAuthRouter } from "./routes/auth";
import { createEmailRouter } from "./routes/emails";
import { createSyncRouter } from "./routes/sync";
import { SyncService } from "./services/sync";
import type Database from "bun:sqlite";
import type { OAuthClient } from "./auth/oauth";
import type { TokenStore } from "./auth/token-store";
import type { GmailAdapter } from "./gmail/adapter";

export interface ServerDeps {
  db: Database;
  oauth?: OAuthClient | null;
  tokenStore?: TokenStore;
  gmailAdapter?: GmailAdapter;
}

export function createApp(deps: ServerDeps): Hono {
  const app = new Hono();
  const { db } = deps;

  app.route("/", createStatusRouter(db));

  if (deps.tokenStore) {
    app.route(
      "/",
      createAuthRouter(deps.oauth ?? null, deps.tokenStore)
    );
  }

  app.route("/", createEmailRouter({ db, gmailAdapter: deps.gmailAdapter }));

  if (deps.gmailAdapter) {
    const syncService = new SyncService(db, deps.gmailAdapter);
    app.route(
      "/",
      createSyncRouter(syncService, deps.gmailAdapter, db)
    );
  }

  return app;
}
