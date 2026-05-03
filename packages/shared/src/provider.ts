export type GmailProviderMode = "google" | "fakeGmail";

export type AiProviderMode = "openai" | "anthropic" | "fakeAI";

export type ProviderMode = GmailProviderMode | AiProviderMode;

export type ProviderProbeStatus = "ok" | "failed" | "not-configured";

export interface ProviderProbeResponse {
  provider: ProviderMode;
  status: ProviderProbeStatus;
  message?: string;
}
