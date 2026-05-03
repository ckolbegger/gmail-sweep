// @ts-nocheck
/** @jsxImportSource @opentui/react */
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createApiClient } from "./api-client";
import { ensureBackend } from "./backend-process";
import { App, type ProbeState } from "./views/App";

const config = loadTuiConfig();
const backend = await ensureBackend({
  host: config.backend.host,
  port: config.backend.port,
});
const api = createApiClient(backend.baseUrl);
const renderer = await createCliRenderer({
  exitOnCtrlC: true,
  clearOnShutdown: true,
});
const root = createRoot(renderer);

let status = await api.getStatus();
let auth = await api.getAuthStatus();
let probe: ProbeState = { state: "idle" };
let closed = false;

render();

async function runProbes(): Promise<void> {
  probe = { state: "running" };
  render();

  try {
    const [gmail, ai] = await Promise.all([api.probeGmail(), api.probeAi()]);
    status = await api.getStatus();
    auth = await api.getAuthStatus();
    probe = { state: "complete", gmail, ai };
  } catch (error) {
    probe = {
      state: "blocked",
      reason: error instanceof Error ? error.message : "Provider probe failed",
    };
  }

  render();
}

function render(): void {
  if (closed) {
    return;
  }

  root.render(
    <App
      backend={backend}
      status={status}
      auth={auth}
      probe={probe}
      onProbe={() => void runProbes()}
      onQuit={shutdown}
    />,
  );
}

function shutdown(): void {
  if (closed) {
    return;
  }

  closed = true;
  root.unmount();
  renderer.destroy();
  backend.stop();
  process.exit(0);
}

function loadTuiConfig(): { backend: { host: string; port: number } } {
  const appHome = process.env.GMAIL_SWEEP_HOME ?? join(process.env.HOME ?? "", ".gmail-sweep");
  const configPath = join(appHome, "config.json");

  if (!existsSync(configPath)) {
    return { backend: { host: "127.0.0.1", port: 3000 } };
  }

  const fileConfig = JSON.parse(readFileSync(configPath, "utf8")) as {
    backend?: { host?: string; port?: number };
  };

  return {
    backend: {
      host: fileConfig.backend?.host ?? "127.0.0.1",
      port: fileConfig.backend?.port ?? 3000,
    },
  };
}
