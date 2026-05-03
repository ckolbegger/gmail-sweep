import type { AiProviderMode, ProviderProbeStatus } from "@gmail-sweep/shared/src/provider";
import type { EmailSummary } from "@gmail-sweep/shared/src/summary";

export interface AiProbeResult {
  provider: AiProviderMode;
  status: ProviderProbeStatus;
  model: string;
  summary: EmailSummary;
  message?: string;
}

export interface AiProvider {
  probe(): Promise<AiProbeResult>;
}
