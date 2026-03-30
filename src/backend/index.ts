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

function expandPath(p: string): string {
  return p.startsWith("~") ? resolve(homedir(), p.slice(1)) : p;
}

const configPath = process.argv[2] || "config.toml";
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

const app = createApp({ db, oauth, tokenStore, gmailAdapter, llmProvider, summaryWorker });

// Start auto-poller
if (gmailAdapter && config.sync.poll_interval_seconds > 0) {
  const syncService = new SyncService(db, gmailAdapter);
  const poller = new AutoPoller({
    intervalMs: config.sync.poll_interval_seconds * 1000,
    onSync: async () => { await syncService.syncNewest(config.sync.batch_size); },
    isAuthorized: () => !!tokenStore.load(),
  });
  poller.start();
  console.log(`Auto-polling every ${config.sync.poll_interval_seconds}s`);
}

// Start summary worker
summaryWorker.start(60000);
console.log(`Starting Gmail Sweep backend on ${config.server.host}:${config.server.port}`);

import { serve } from "bun";
serve({
  port: config.server.port,
  hostname: config.server.host,
  fetch: app.fetch,
});
