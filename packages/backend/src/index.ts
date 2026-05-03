import { serve } from "bun";
import { createApp } from "./app";
import { loadConfig } from "./config/load";

const config = loadConfig();
const app = createApp({ config });

serve({
  fetch: app.fetch,
  hostname: config.backend.host,
  port: config.backend.port,
});

console.log(`gmail-sweep backend listening on ${config.backend.host}:${config.backend.port}`);
