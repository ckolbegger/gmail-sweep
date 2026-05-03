import type { AppConfig } from "@gmail-sweep/shared/src/config";
import type { AiProbeResult, AiProvider } from "./types";

const fakeSummary = {
  description: "Deterministic fake AI summary for provider probes.",
  actionItems: ["Review gmail-sweep-test messages"],
  keyPoints: ["Fake AI provider is reachable", "No external AI service was called"],
};

export function createFakeAiProvider(config: AppConfig): AiProvider {
  return {
    async probe(): Promise<AiProbeResult> {
      return {
        provider: "fakeAI",
        status: "ok",
        model: config.ai.model,
        summary: fakeSummary,
      };
    },
  };
}
