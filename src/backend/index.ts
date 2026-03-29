import { serve } from "bun";
import { loadConfig } from "./config";
import { initDb } from "./db";
import { createApp } from "./server";

const configPath = process.argv[2] || "config.toml";
const config = loadConfig(configPath);
const db = initDb("gmail-sweep.db");
const app = createApp({ db });

console.log(`Starting Gmail Sweep backend on ${config.server.host}:${config.server.port}`);

serve({
  port: config.server.port,
  hostname: config.server.host,
  fetch: app.fetch,
});
