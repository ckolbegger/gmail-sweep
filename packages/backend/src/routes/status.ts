import { Hono } from "hono";
import type { AppConfig } from "@gmail-sweep/shared/src/config";

export function createStatusRoute(config: AppConfig) {
  const route = new Hono();

  route.get("/status", (c) =>
    c.json({
      ok: true,
      version: "0.1.0",
      providerMode: config.gmail.provider,
      providerModes: {
        gmail: config.gmail.provider,
        ai: config.ai.provider,
      },
      activeAccount: {
        id: config.activeAccountId,
        authenticated: config.activeAccountId !== null,
      },
    }),
  );

  return route;
}
