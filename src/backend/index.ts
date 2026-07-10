import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { loadConfig } from "./config";
import { initDb } from "./db";
import { TokenStore } from "./auth/token-store";
import { OAuthClient } from "./auth/oauth";
import { GmailApiClient } from "./gmail/gmail-api";
import { createLlmProvider } from "./llm/create-provider";
import { SummaryWorker } from "./services/summary-worker";
import { SyncService } from "./services/sync";
import { AutoPoller } from "./services/auto-poller";
import { createApp } from "./server";
import { startBackgroundWorkers } from "./bootstrap";
import { createEmbedProvider } from "./services/embed-provider";
import { EmbeddingWorker } from "./services/embedding-worker";

function expandPath(p: string): string {
  return p.startsWith("~") ? resolve(homedir(), p.slice(1)) : p;
}

const configPath = process.argv[2] || "config.toml";
// Safety net for unhandled promise rejections
process.on("unhandledRejection", (reason) => {
  console.error("[FATAL] Unhandled rejection:", reason);
});

const config = loadConfig(configPath);
const db = initDb("gmail-sweep.db");

const tokenStore = new TokenStore(expandPath(config.auth.token_path));
let oauth: OAuthClient | null = null;
const credPath = expandPath(config.auth.credentials_path);
if (existsSync(credPath)) {
  const raw = await Bun.file(credPath).text();
  const creds = JSON.parse(raw);
  oauth = new OAuthClient(
    {
      client_id: creds.client_id,
      client_secret: creds.client_secret,
      redirect_uri: `http://${config.server.host}:${config.server.port}/auth/callback`,
    },
    tokenStore,
  );
}

const gmailAdapter = oauth
  ? new GmailApiClient(() => oauth!.getValidToken())
  : undefined;

const llmProvider = createLlmProvider(config.llm);
const summaryWorker = new SummaryWorker(db, llmProvider);

const embedProvider = createEmbedProvider({
  provider: config.embedding.provider,
  model: config.embedding.model,
  dimension: config.embedding.dimension,
  api_key: config.embedding.api_key,
  base_url: config.embedding.base_url,
});
const activeStrategy = config.content_extraction.strategies[config.content_extraction.active_strategy]
  ?? { type: "template" as const, template: "Subject: {{subject}}\n\n{{body_text}}" };
const embeddingWorker = new EmbeddingWorker(
  db,
  embedProvider,
  activeStrategy,
  config.embedding.dimension
);

const app = createApp({
  db,
  oauth,
  tokenStore,
  gmailAdapter,
  llmProvider,
  embeddingProvider: embedProvider,
  embeddingWorker,
  summaryWorker,
  configPath,
});

// Start auto-poller
if (gmailAdapter && config.sync.poll_interval_seconds > 0) {
  const syncService = new SyncService(db, gmailAdapter);
  const poller = new AutoPoller({
    intervalMs: config.sync.poll_interval_seconds * 1000,
    onSync: async () => {
	      const result = await syncService.syncNewest(config.sync.batch_size);
	      if (result.fetched > 0) {
	        try {
	          await summaryWorker.processPending();
	        } catch (err) {
	          console.error("Summary worker error:", err);
	        }
	        try {
	          await embeddingWorker.processPending();
	        } catch (err) {
	          console.error("Embedding worker error:", err);
	        }
	      }
	    },
    isAuthorized: () => !!tokenStore.load(),
  });
  poller.start();
  console.log(`Auto-polling every ${config.sync.poll_interval_seconds}s`);
}

// Start background workers (summary + embeddings)
startBackgroundWorkers({ summaryWorker, embeddingWorker }, 60_000);
console.log(`Starting Gmail Sweep backend on ${config.server.host}:${config.server.port}`);

import { serve } from "bun";
serve({
  port: config.server.port,
  hostname: config.server.host,
  fetch: app.fetch,
});
