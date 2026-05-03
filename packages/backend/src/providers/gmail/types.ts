import type { GmailProviderMode, ProviderProbeStatus } from "@gmail-sweep/shared/src/provider";

export interface GmailProbeAccount {
  id: string;
  email: string;
  authenticated: boolean;
}

export interface GmailProbeLabel {
  id: string;
  name: string;
}

export interface GmailProbeMessage {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  snippet: string;
  labels: string[];
}

export interface GmailProbeResult {
  provider: GmailProviderMode;
  status: ProviderProbeStatus;
  account: GmailProbeAccount;
  label: GmailProbeLabel;
  messages: GmailProbeMessage[];
}

export interface GmailProvider {
  probe(): Promise<GmailProbeResult>;
}
