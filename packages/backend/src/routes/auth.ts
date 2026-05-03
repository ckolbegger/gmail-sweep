import { spawn } from "node:child_process";
import { Hono } from "hono";
import type { AppConfig } from "@gmail-sweep/shared/src/config";
import {
  createGoogleAuthUrl,
  exchangeGoogleCodeForTokens,
  readGoogleCredentials,
  readStoredGoogleTokens,
  refreshGoogleAccessToken,
  writeStoredGoogleTokens,
  type GoogleTokenRefresh,
  type StoredGoogleTokens,
} from "../providers/gmail/google";

type Env = Record<string, string | undefined>;

export interface AuthRouteOptions {
  config: AppConfig;
  env?: Env;
  openBrowser?: (url: string) => Promise<void> | void;
  exchangeCodeForTokens?: (code: string, env: Env, redirectUri: string) => Promise<StoredGoogleTokens>;
  refreshAccessToken?: (refreshToken: string, env: Env) => Promise<GoogleTokenRefresh>;
  now?: () => number;
}

export function createAuthRoutes(options: AuthRouteOptions) {
  const route = new Hono();
  const env = options.env ?? process.env;
  const now = options.now ?? Date.now;
  const exchangeTokens = options.exchangeCodeForTokens ?? exchangeGoogleCodeForTokens;
  const refreshToken = options.refreshAccessToken ?? refreshGoogleAccessToken;
  const openBrowser = options.openBrowser ?? defaultOpenBrowser;

  route.get("/auth/status", async (c) => {
    const accountId = options.config.activeAccountId ?? "";

    if (!accountId) {
      return c.json({ provider: "google", authenticated: false, accountId });
    }

    const stored = readStoredGoogleTokens(env, accountId);

    if (!stored) {
      return c.json({ provider: "google", authenticated: false, accountId });
    }

    if (stored.expiresAt <= now()) {
      const refreshed = await refreshToken(stored.refreshToken, env);
      writeStoredGoogleTokens(env, accountId, {
        accessToken: refreshed.accessToken,
        refreshToken: stored.refreshToken,
        expiresAt: refreshed.expiresAt,
      });
    }

    return c.json({ provider: "google", authenticated: true, accountId });
  });

  route.post("/auth/start", async (c) => {
    const credentials = readGoogleCredentials(env);

    if (!credentials) {
      return c.json(
        {
          status: "BLOCKED",
          reason: "Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET",
        },
        200,
      );
    }

    const redirectUri = createRedirectUri(options.config);
    const authUrl = createGoogleAuthUrl(credentials, redirectUri);

    try {
      await openBrowser(authUrl);
      return c.json({
        status: "ok",
        authUrl,
        browserOpened: true,
        manualOpenRequired: false,
      });
    } catch (error) {
      return c.json({
        status: "ok",
        authUrl,
        browserOpened: false,
        manualOpenRequired: true,
        fallbackReason: error instanceof Error ? error.message : "Browser opener failed",
      });
    }
  });

  route.get("/auth/callback", async (c) => {
    const accountId = options.config.activeAccountId ?? "";
    const code = c.req.query("code");

    if (!accountId) {
      return c.json({ status: "BLOCKED", reason: "Missing active account" }, 400);
    }

    if (!code) {
      return c.json({ status: "BLOCKED", reason: "Missing OAuth code" }, 400);
    }

    const tokens = await exchangeTokens(code, env, createRedirectUri(options.config));
    writeStoredGoogleTokens(env, accountId, tokens);

    return c.json({
      status: "ok",
      accountId,
      authenticated: true,
    });
  });

  return route;
}

function createRedirectUri(config: AppConfig): string {
  return `http://${config.backend.host}:${config.backend.port}/auth/callback`;
}

function defaultOpenBrowser(url: string): Promise<void> {
  const command =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}
