import { Hono } from "hono";
import type { AppConfig } from "@gmail-sweep/shared/src/config";
import { loadConfig } from "./config/load";
import { createFakeAiProvider } from "./providers/ai/fake";
import type { AiProvider } from "./providers/ai/types";
import { createFakeGmailProvider } from "./providers/gmail/fake";
import type { GmailProvider } from "./providers/gmail/types";
import { createProviderRoutes } from "./routes/providers";
import { createStatusRoute } from "./routes/status";

export interface CreateAppOptions {
  config?: AppConfig;
  gmailProvider?: GmailProvider;
  aiProvider?: AiProvider;
}

export function createApp(options: CreateAppOptions = {}) {
  const config = options.config ?? loadConfig();
  const app = new Hono();
  const gmailProvider = options.gmailProvider ?? createGmailProvider(config);
  const aiProvider = options.aiProvider ?? createAiProvider(config);

  app.route("/", createStatusRoute(config));
  app.route("/", createProviderRoutes({ gmailProvider, aiProvider }));

  return app;
}

function createGmailProvider(config: AppConfig): GmailProvider {
  if (config.gmail.provider === "fakeGmail") {
    return createFakeGmailProvider(config);
  }

  return {
    async probe() {
      return {
        provider: config.gmail.provider,
        status: "not-configured",
        account: {
          id: config.activeAccountId ?? "",
          email: "",
          authenticated: false,
        },
        label: {
          id: "",
          name: "",
        },
        messages: [],
      };
    },
  };
}

function createAiProvider(config: AppConfig): AiProvider {
  if (config.ai.provider === "fakeAI") {
    return createFakeAiProvider(config);
  }

  return {
    async probe() {
      return {
        provider: config.ai.provider,
        status: "not-configured",
        model: config.ai.model,
        summary: {
          description: "",
          actionItems: [],
          keyPoints: [],
        },
      };
    },
  };
}
