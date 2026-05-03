import Anthropic from "@anthropic-ai/sdk";
import type { AppConfig } from "@gmail-sweep/shared/src/config";
import type { AiProbeResult, AiProvider } from "./types";

type Env = Record<string, string | undefined>;

export interface AnthropicProbeClient {
  messages: {
    create(request: {
      model: string;
      max_tokens: number;
      temperature: number;
      messages: { role: "user"; content: string }[];
    }): Promise<{ content?: { type?: string; text?: string }[] | null }>;
  };
}

const probeInput = "Summarize this test email in one short sentence: gmail-sweep AI provider probe.";

export function createAnthropicAiProvider(
  config: AppConfig,
  env: Env = process.env,
  client?: AnthropicProbeClient,
): AiProvider {
  return {
    async probe(): Promise<AiProbeResult> {
      const apiKeyName = config.ai.apiKeyEnv ?? "ANTHROPIC_API_KEY";
      const apiKey = env[apiKeyName];

      if (!apiKey) {
        return probeResult(config, "not-configured", "", `Missing ${apiKeyName}`);
      }

      try {
        const anthropic = client ?? new Anthropic({ apiKey });
        const response = await anthropic.messages.create({
          model: config.ai.model,
          max_tokens: 64,
          temperature: 0,
          messages: [{ role: "user", content: probeInput }],
        });
        let text = "";

        for (const item of response.content ?? []) {
          if (item.type === "text" && "text" in item && typeof item.text === "string") {
            text = item.text.trim();
            break;
          }
        }

        return probeResult(config, "ok", text || "Anthropic probe completed.");
      } catch (error) {
        return probeResult(config, "failed", "", error instanceof Error ? error.message : "Anthropic probe failed");
      }
    },
  };
}

function probeResult(
  config: AppConfig,
  status: AiProbeResult["status"],
  description: string,
  message?: string,
): AiProbeResult {
  return {
    provider: "anthropic",
    status,
    model: config.ai.model,
    summary: {
      description,
      actionItems: [],
      keyPoints: [],
    },
    message,
  };
}
