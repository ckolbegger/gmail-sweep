export type GmailProviderMode = "google" | "fake";

export type AiProviderMode = "openai" | "anthropic" | "fake";

export type ProviderMode = GmailProviderMode | AiProviderMode;

export type ProviderProbeStatus = "ok" | "failed" | "not-configured";

export interface ProviderProbeResponse {
  provider: ProviderMode;
  status: ProviderProbeStatus;
  message?: string;
}
