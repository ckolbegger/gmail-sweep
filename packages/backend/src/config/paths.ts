import { join } from "node:path";

type ConfigEnv = Record<string, string | undefined> & {
  GMAIL_SWEEP_HOME?: string;
  HOME?: string;
};

export function getAppHome(env: ConfigEnv = process.env): string {
  return env.GMAIL_SWEEP_HOME ?? join(env.HOME ?? "", ".gmail-sweep");
}

export function getConfigPath(home: string): string {
  return join(home, "config.json");
}

export function getAccountsPath(home: string): string {
  return join(home, "accounts");
}

export function getAccountDir(home: string, accountId: string): string {
  return join(getAccountsPath(home), accountId);
}

export function getAccountDbPath(home: string, accountId: string): string {
  return join(getAccountDir(home, accountId), "mail.sqlite");
}
