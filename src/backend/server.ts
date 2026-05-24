import { Hono } from "hono";
import { createStatusRouter } from "./routes/status";
import { createAuthRouter } from "./routes/auth";
import { createEmailRouter } from "./routes/emails";
import { createSyncRouter } from "./routes/sync";
import { createSearchRouter } from "./routes/search";
import { createConfigRouter } from "./routes/config";
import { createSummarizerRouter } from "./routes/summarizer";
import { createEmbeddingsRouter } from "./routes/embeddings";
import { SyncService } from "./services/sync";
import { SearchService } from "./services/search";
import type { EmbedProvider } from "./services/embed-provider";
import type { EmbeddingWorker } from "./services/embedding-worker";
import type { LLMProvider } from "./llm/provider";
import type Database from "bun:sqlite";
import type { OAuthClient } from "./auth/oauth";
import type { TokenStore } from "./auth/token-store";
import type { GmailAdapter } from "./gmail/adapter";

export interface ServerDeps {
  db: Database;
  oauth?: OAuthClient | null;
  tokenStore?: TokenStore;
  gmailAdapter?: GmailAdapter;
  llmProvider?: LLMProvider;
  embeddingProvider?: EmbedProvider;
  embeddingWorker?: EmbeddingWorker;
  summaryWorker?: any;
  configPath?: string;
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

  const searchService = new SearchService(db, deps.embeddingProvider, deps.llmProvider);
  app.route("/", createSearchRouter(searchService));

  if (deps.gmailAdapter) {
    const syncService = new SyncService(db, deps.gmailAdapter);
    app.route(
      "/",
      createSyncRouter(syncService, deps.gmailAdapter, db, deps.summaryWorker, deps.embeddingWorker)
    );
  }

  if (deps.configPath) {
    app.route("/", createConfigRouter(deps.configPath));
  }

  if (deps.summaryWorker) {
    app.route("/", createSummarizerRouter(deps.summaryWorker));
  }

  if (deps.embeddingWorker) {
    app.route("/", createEmbeddingsRouter(deps.embeddingWorker));
  }

  return app;
}
