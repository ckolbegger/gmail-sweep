import { Hono } from "hono";
import type { AiProvider } from "../providers/ai/types";
import type { GmailProvider } from "../providers/gmail/types";

export interface ProviderRouteOptions {
  gmailProvider: GmailProvider;
  aiProvider: AiProvider;
}

export function createProviderRoutes(options: ProviderRouteOptions) {
  const route = new Hono();

  route.post("/providers/gmail/probe", async (c) => {
    const result = await options.gmailProvider.probe();
    return c.json(result);
  });
  route.post("/providers/ai/probe", async (c) => c.json(await options.aiProvider.probe()));

  return route;
}
