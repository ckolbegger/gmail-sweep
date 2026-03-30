import type { LLMProvider } from "./provider";
import { OpenAIAdapter } from "./openai-adapter";
import { AnthropicAdapter } from "./anthropic-adapter";

export function createLlmProvider(
  config: { provider: string; api_key: string; model: string; base_url: string }
): LLMProvider {
  const opts = {
    apiKey: config.api_key,
    model: config.model,
    baseUrl: config.base_url,
  };

  switch (config.provider) {
    case "openai":
      return new OpenAIAdapter(opts);
    case "anthropic":
      return new AnthropicAdapter(opts);
    default:
      throw new Error(`Unknown LLM provider: ${config.provider}`);
  }
}
