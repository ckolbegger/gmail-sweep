import OpenAI from "openai";
import type { AppConfig } from "@gmail-sweep/shared/src/config";
import type { AiProbeResult, AiProvider } from "./types";

type Env = Record<string, string | undefined>;

export interface OpenAiProbeClient {
  responses: {
    create(request: {
      model: string;
      input: string;
      max_output_tokens: number;
      temperature: number;
    }): Promise<{ output_text?: string | null }>;
  };
}

const probeInput = "Summarize this test email in one short sentence: gmail-sweep AI provider probe.";

export function createOpenAiProvider(config: AppConfig, env: Env = process.env, client?: OpenAiProbeClient): AiProvider {
  return {
    async probe(): Promise<AiProbeResult> {
      const apiKeyName = config.ai.apiKeyEnv ?? "OPENAI_API_KEY";
      const apiKey = env[apiKeyName];

      if (!apiKey) {
        return probeResult(config, "not-configured", "", `Missing ${apiKeyName}`);
      }

      try {
        const openai = client ?? new OpenAI({ apiKey });
        const response = await openai.responses.create({
          model: config.ai.model,
          input: probeInput,
          max_output_tokens: 64,
          temperature: 0,
        });

        return probeResult(config, "ok", response.output_text?.trim() || "OpenAI probe completed.");
      } catch (error) {
        return probeResult(config, "failed", "", error instanceof Error ? error.message : "OpenAI probe failed");
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
    provider: "openai",
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
