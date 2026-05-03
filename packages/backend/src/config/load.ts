import { existsSync, readFileSync } from "node:fs";
import type { AppConfig } from "@gmail-sweep/shared/src/config";
import { getAppHome, getConfigPath } from "./paths";

const defaultConfig: AppConfig = {
  activeAccountId: null,
  gmail: { provider: "fakeGmail" },
  sync: { maxMessagesPerFetch: 100 },
  ai: { provider: "fakeAI", model: "fake" },
  dev: { provider: "fakeGmail" },
  backend: { host: "127.0.0.1", port: 3000 },
};

type PartialAppConfig = {
  activeAccountId?: AppConfig["activeAccountId"];
  gmail?: Partial<AppConfig["gmail"]>;
  sync?: Partial<AppConfig["sync"]>;
  ai?: Partial<AppConfig["ai"]>;
  dev?: Partial<AppConfig["dev"]>;
  backend?: Partial<AppConfig["backend"]>;
};

export function loadConfig(env = process.env): AppConfig {
  const configPath = getConfigPath(getAppHome(env));
  const fileConfig = existsSync(configPath)
    ? (JSON.parse(readFileSync(configPath, "utf8")) as PartialAppConfig)
    : {};

  return {
    ...defaultConfig,
    ...fileConfig,
    gmail: { ...defaultConfig.gmail, ...fileConfig.gmail },
    sync: { ...defaultConfig.sync, ...fileConfig.sync },
    ai: { ...defaultConfig.ai, ...fileConfig.ai },
    dev: { ...defaultConfig.dev, ...fileConfig.dev },
    backend: { ...defaultConfig.backend, ...fileConfig.backend },
  };
}
