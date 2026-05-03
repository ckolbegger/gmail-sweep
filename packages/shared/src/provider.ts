export type ProviderMode = "gmail" | "fake" | "openai" | "anthropic";

export type ProviderProbeStatus = "ok" | "failed" | "not-configured";

export interface ProviderProbeResponse {
  provider: ProviderMode;
  status: ProviderProbeStatus;
  message?: string;
}
