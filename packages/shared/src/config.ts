import type { ProviderMode } from "./provider";

export interface SyncConfig {
  maxMessagesPerFetch: number;
}

export interface AiConfig {
  provider: ProviderMode;
  model: string;
  apiKeyEnv?: string;
}

export interface DevConfig {
  provider: ProviderMode;
  scenario?: string;
}

export interface AppConfig {
  activeAccountId: string | null;
  sync: SyncConfig;
  ai: AiConfig;
  dev: DevConfig;
  backend: {
    host: string;
    port: number;
  };
}
