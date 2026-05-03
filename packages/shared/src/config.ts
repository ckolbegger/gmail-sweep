import type { AiProviderMode, GmailProviderMode } from "./provider";

export interface SyncConfig {
  maxMessagesPerFetch: number;
}

export interface GmailConfig {
  provider: GmailProviderMode;
}

export interface AiConfig {
  provider: AiProviderMode;
  model: string;
  apiKeyEnv?: string;
}

export interface DevConfig {
  provider: GmailProviderMode;
  scenario?: string;
}

export interface AppConfig {
  activeAccountId: string | null;
  gmail: GmailConfig;
  sync: SyncConfig;
  ai: AiConfig;
  dev: DevConfig;
  backend: {
    host: string;
    port: number;
  };
}
