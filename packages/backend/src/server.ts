import Fastify from 'fastify';
import * as path from 'node:path';
import * as os from 'node:os';
import { loadConfig } from './config.js';
import { createDb } from './services/db.js';
import { createGmailService } from './services/gmail.js';
import { createAiService } from './services/ai.js';
import { createEmbedService } from './services/embed.js';
import { createSearchService } from './services/search.js';
import { createSummarizerWorker } from './services/summarizer.js';
import { createAutoPoller } from './services/auto-poller.js';
import { runSyncWithEmbeddings } from './services/sync.js';
import { authRoutes } from './routes/auth.js';
import { emailRoutes } from './routes/emails.js';
import { syncRoutes } from './routes/sync.js';
import { searchRoutes } from './routes/search.js';
import { configRoutes } from './routes/config.js';
import { summarizerRoutes } from './routes/summarizer.js';
import { labelsRoutes } from './routes/labels.js';
import { statusRoutes } from './routes/status.js';

export async function buildServer(options?: { dbPath?: string }) {
  const app = Fastify({ logger: true });
  const config = await loadConfig();

  const dbPath = options?.dbPath ?? path.join(os.homedir(), '.gmail-sweep', 'emails.db');
  const db = createDb(dbPath);

  const gmail = createGmailService(
    config.google.clientId,
    config.google.clientSecret,
    config.google.redirectUri
  );

  const ai = createAiService(config.llm);
  const embed = createEmbedService(config.embedding);
  const search = createSearchService(db, ai, embed);
  const summarizer = createSummarizerWorker(db, ai);

  app.get('/health', async () => ({ status: 'ok' }));

  await app.register(authRoutes, { gmail });
  await app.register(emailRoutes, { db, gmail, ai });
  await app.register(syncRoutes, { db, gmail, embed, config, defaultBatchSize: config.sync.defaultBatchSize, summarizer });
  await app.register(searchRoutes, { search });
  await app.register(configRoutes);
  await app.register(summarizerRoutes, { summarizer });
  await app.register(labelsRoutes, { gmail });
  await app.register(statusRoutes, { db });

  const poller = createAutoPoller({
    intervalMs: config.sync.autoPollIntervalMs ?? 0,
    isAuthorized: () => gmail.isAuthenticated(),
    onSync: async () => {
      await runSyncWithEmbeddings(db, gmail, embed, config, { batchSize: config.sync.defaultBatchSize });
      summarizer.trigger();
    },
    logger: app.log,
  });
  poller.start();
  app.addHook('onClose', async () => poller.stop());

  return app;
}
