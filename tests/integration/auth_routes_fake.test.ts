import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { createApp } from "../../packages/backend/src/app";
import type { AppConfig } from "../../packages/shared/src/config";
import {
  checkRealPrereqs,
  type PrereqGmailProbe,
} from "../../scripts/acceptance/check-real-prereqs";

const tempHomes: string[] = [];

afterEach(() => {
  for (const home of tempHomes.splice(0)) {
    rmSync(home, { recursive: true, force: true });
  }
});

function createTempHome() {
  const home = mkdtempSync(join(tmpdir(), "gmail-sweep-auth-test-"));
  tempHomes.push(home);
  return home;
}

function config(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    activeAccountId: "active-account",
    gmail: { provider: "google" },
    sync: { maxMessagesPerFetch: 100 },
    ai: { provider: "fakeAI", model: "fake" },
    dev: { provider: "fakeGmail", scenario: "seeded" },
    backend: { host: "127.0.0.1", port: 3000 },
    ...overrides,
  };
}

describe("gmail oauth component", () => {
  test("it should report unauthenticated with no token", async () => {
    const app = createApp({
      config: config(),
      auth: {
        env: { GMAIL_SWEEP_HOME: createTempHome() },
      },
    });

    const response = await app.request("/auth/status");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      provider: "google",
      authenticated: false,
      accountId: "active-account",
    });
  });

  test("it should read gmail client id and secret from environment variables", async () => {
    const openedUrls: string[] = [];
    const app = createApp({
      config: config(),
      auth: {
        env: {
          GMAIL_SWEEP_HOME: createTempHome(),
          GOOGLE_CLIENT_ID: "client-id-from-env",
          GOOGLE_CLIENT_SECRET: "client-secret-from-env",
        },
        openBrowser: async (url) => {
          openedUrls.push(url);
        },
      },
    });

    const response = await app.request("/auth/start", { method: "POST" });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.authUrl).toContain("client_id=client-id-from-env");
    expect(body.authUrl).toContain("scope=https%3A%2F%2Fmail.google.com%2F");
    expect(body.authUrl).toContain("redirect_uri=http%3A%2F%2F127.0.0.1%3A3000%2Fauth%2Fcallback");
    expect(openedUrls).toEqual([body.authUrl]);
  });

  test("it should open a browser to the OAuth login and consent page", async () => {
    const openedUrls: string[] = [];
    const app = createApp({
      config: config(),
      auth: {
        env: {
          GMAIL_SWEEP_HOME: createTempHome(),
          GOOGLE_CLIENT_ID: "browser-client",
          GOOGLE_CLIENT_SECRET: "browser-secret",
        },
        openBrowser: async (url) => {
          openedUrls.push(url);
        },
      },
    });

    const response = await app.request("/auth/start", { method: "POST" });
    const body = await response.json();

    expect(openedUrls).toEqual([body.authUrl]);
    expect(body.authUrl).toStartWith("https://accounts.google.com/o/oauth2/v2/auth?");
  });

  test("it should accept an HTTP request to the redirect endpoint and exchange the code for tokens", async () => {
    const seenCodes: string[] = [];
    const home = createTempHome();
    const app = createApp({
      config: config(),
      auth: {
        env: { GMAIL_SWEEP_HOME: home },
        exchangeCodeForTokens: async (code) => {
          seenCodes.push(code);
          return {
            accessToken: "access-from-code",
            refreshToken: "refresh-from-code",
            expiresAt: Date.now() + 3600_000,
          };
        },
      },
    });

    const response = await app.request("/auth/callback?code=oauth-code");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      accountId: "active-account",
      authenticated: true,
    });
    expect(seenCodes).toEqual(["oauth-code"]);
  });

  test("it should store both the access token and refresh token under the active account", async () => {
    const home = createTempHome();
    const app = createApp({
      config: config(),
      auth: {
        env: { GMAIL_SWEEP_HOME: home },
        exchangeCodeForTokens: async () => ({
          accessToken: "stored-access",
          refreshToken: "stored-refresh",
          expiresAt: 4_102_444_800_000,
        }),
      },
    });

    await app.request("/auth/callback?code=oauth-code");

    const tokenFile = join(home, "accounts", "active-account", "tokens.json");
    expect(JSON.parse(readFileSync(tokenFile, "utf8"))).toEqual({
      accessToken: "stored-access",
      refreshToken: "stored-refresh",
      expiresAt: 4_102_444_800_000,
    });
  });

  test("it should use the refresh token to get a new access token if the access token has expired", async () => {
    const home = createTempHome();
    const refreshTokens: string[] = [];
    const app = createApp({
      config: config(),
      auth: {
        env: { GMAIL_SWEEP_HOME: home },
        now: () => 2_000,
        exchangeCodeForTokens: async () => ({
          accessToken: "expired-access",
          refreshToken: "usable-refresh",
          expiresAt: 1_000,
        }),
        refreshAccessToken: async (refreshToken) => {
          refreshTokens.push(refreshToken);
          return {
            accessToken: "fresh-access",
            expiresAt: 60_000,
          };
        },
      },
    });

    await app.request("/auth/callback?code=oauth-code");
    const response = await app.request("/auth/status");

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      provider: "google",
      authenticated: true,
      accountId: "active-account",
    });
    expect(refreshTokens).toEqual(["usable-refresh"]);

    const tokenFile = join(home, "accounts", "active-account", "tokens.json");
    expect(JSON.parse(readFileSync(tokenFile, "utf8"))).toEqual({
      accessToken: "fresh-access",
      refreshToken: "usable-refresh",
      expiresAt: 60_000,
    });
  });
});

describe("real gmail prereq checker", () => {
  test("it should report BLOCKED when Google credentials are missing", async () => {
    const result = await checkRealPrereqs({
      env: {},
      config: config({ ai: { provider: "fakeAI", model: "fake" } }),
      gmail: passingGmailProbe(),
    });

    expect(result.status).toBe("BLOCKED");
    expect(result.reasons).toContain("Missing GOOGLE_CLIENT_ID");
    expect(result.reasons).toContain("Missing GOOGLE_CLIENT_SECRET");
  });

  test("it should verify the gmail-sweep-test label exists", async () => {
    const result = await checkRealPrereqs({
      env: googleEnv(),
      config: config(),
      gmail: {
        async getProfile() {
          return { email: "user@example.com" };
        },
        async findLabel() {
          return null;
        },
        async listMessagesForLabel() {
          return [];
        },
      },
    });

    expect(result.status).toBe("BLOCKED");
    expect(result.reasons).toContain("Missing Gmail label gmail-sweep-test");
  });

  test("it should verify the test label has at least one read-only acceptance message", async () => {
    const result = await checkRealPrereqs({
      env: googleEnv(),
      config: config(),
      gmail: {
        async getProfile() {
          return { email: "user@example.com" };
        },
        async findLabel() {
          return { id: "Label_gmail_sweep_test", name: "gmail-sweep-test" };
        },
        async listMessagesForLabel() {
          return [];
        },
      },
    });

    expect(result.status).toBe("BLOCKED");
    expect(result.reasons).toContain("No read-only acceptance messages found in gmail-sweep-test");
  });

  test("it should pass when all real Gmail prereqs exist", async () => {
    const result = await checkRealPrereqs({
      env: googleEnv(),
      config: config(),
      gmail: passingGmailProbe(),
    });

    expect(result).toEqual({
      status: "PASS",
      reasons: [],
    });
  });
});

function googleEnv() {
  return {
    GOOGLE_CLIENT_ID: "client",
    GOOGLE_CLIENT_SECRET: "secret",
  };
}

function passingGmailProbe(): PrereqGmailProbe {
  return {
    async getProfile() {
      return { email: "user@example.com" };
    },
    async findLabel() {
      return { id: "Label_gmail_sweep_test", name: "gmail-sweep-test" };
    },
    async listMessagesForLabel() {
      return [{ id: "message-1" }];
    },
  };
}
