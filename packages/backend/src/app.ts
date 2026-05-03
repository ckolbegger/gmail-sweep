import { Hono } from "hono";
import type { AppConfig } from "@gmail-sweep/shared/src/config";
import { loadConfig } from "./config/load";
import { createAnthropicAiProvider } from "./providers/ai/anthropic";
import { createFakeAiProvider } from "./providers/ai/fake";
import { createOpenAiProvider } from "./providers/ai/openai";
import type { AiProvider } from "./providers/ai/types";
import { createFakeGmailProvider } from "./providers/gmail/fake";
import { createGoogleGmailProvider } from "./providers/gmail/google";
import type { GmailProvider } from "./providers/gmail/types";
import { createAuthRoutes, type AuthRouteOptions } from "./routes/auth";
import { createProviderRoutes } from "./routes/providers";
import { createStatusRoute } from "./routes/status";

export interface CreateAppOptions {
  config?: AppConfig;
  gmailProvider?: GmailProvider;
  aiProvider?: AiProvider;
  auth?: Omit<AuthRouteOptions, "config">;
}

export function createApp(options: CreateAppOptions = {}) {
  const config = options.config ?? loadConfig();
  const app = new Hono();
  const gmailProvider = options.gmailProvider ?? createGmailProvider(config);
  const aiProvider = options.aiProvider ?? createAiProvider(config);

  app.route("/", createStatusRoute(config));
  app.route("/", createAuthRoutes({ config, ...options.auth }));
  app.route("/", createProviderRoutes({ gmailProvider, aiProvider }));

  return app;
}

function createGmailProvider(config: AppConfig): GmailProvider {
  if (config.gmail.provider === "fakeGmail") {
    return createFakeGmailProvider(config);
  }

  return createGoogleGmailProvider(config);
}

function createAiProvider(config: AppConfig): AiProvider {
  if (config.ai.provider === "fakeAI") {
    return createFakeAiProvider(config);
  }

  if (config.ai.provider === "openai") {
    return createOpenAiProvider(config);
  }

  return createAnthropicAiProvider(config);
}
