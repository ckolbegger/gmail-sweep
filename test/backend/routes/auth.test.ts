import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { createAuthRouter } from "@backend/routes/auth";
import { OAuthClient } from "@backend/auth/oauth";
import { TokenStore } from "@backend/auth/token-store";
import { Hono } from "hono";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const FIXTURE_DIR = join(tmpdir(), "gmail-sweep-auth-routes-test");

beforeEach(() => {
  mkdirSync(FIXTURE_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(FIXTURE_DIR, { recursive: true, force: true });
});

function createTestAuthApp(
  creds: Record<string, string> | null,
  tokenStore: TokenStore
) {
  const credentials = creds as any;
  const oauth = credentials
    ? new OAuthClient(credentials, tokenStore)
    : null;
  const router = createAuthRouter(oauth, tokenStore);
  return new Hono().route("/", router);
}

describe("OAuth routes", () => {
  describe("GET /auth/url", () => {
    it("should return the Google authorization URL", async () => {
      const tokenStore = new TokenStore(join(FIXTURE_DIR, "token.json"));
      const app = createTestAuthApp(
        {
          client_id: "test-id",
          client_secret: "test-secret",
          redirect_uri: "http://localhost:3000/auth/callback",
        },
        tokenStore
      );

      const res = await app.request("/auth/url");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.url).toContain("accounts.google.com");
    });

    it("should return 503 if credentials.json is not configured", async () => {
      const tokenStore = new TokenStore(join(FIXTURE_DIR, "token.json"));
      const app = createTestAuthApp(null, tokenStore);

      const res = await app.request("/auth/url");
      expect(res.status).toBe(503);
    });
  });

  describe("GET /auth/callback", () => {
    it("should return 400 if state parameter does not match", async () => {
      const tokenStore = new TokenStore(join(FIXTURE_DIR, "token.json"));
      const app = createTestAuthApp(
        {
          client_id: "test-id",
          client_secret: "test-secret",
          redirect_uri: "http://localhost:3000/auth/callback",
        },
        tokenStore
      );

      // First get an auth URL to generate state
      const urlRes = await app.request("/auth/url");
      const { url } = await urlRes.json();

      const res = await app.request(
        "/auth/callback?code=test&state=wrong-state"
      );
      expect(res.status).toBe(400);
    });

    it("should return 400 if code is missing", async () => {
      const tokenStore = new TokenStore(join(FIXTURE_DIR, "token.json"));
      const app = createTestAuthApp(
        {
          client_id: "test-id",
          client_secret: "test-secret",
          redirect_uri: "http://localhost:3000/auth/callback",
        },
        tokenStore
      );

      const res = await app.request("/auth/callback?state=anything");
      expect(res.status).toBe(400);
    });
  });

  describe("GET /auth/status", () => {
    it("should return authorized=true when valid tokens exist", async () => {
      const tokenStore = new TokenStore(join(FIXTURE_DIR, "token.json"));
      tokenStore.save({
        access_token: "at",
        refresh_token: "rt",
        expiry_date: Date.now() + 3600000,
      });
      const app = createTestAuthApp(
        {
          client_id: "test-id",
          client_secret: "test-secret",
          redirect_uri: "http://localhost:3000/auth/callback",
        },
        tokenStore
      );

      const res = await app.request("/auth/status");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.authorized).toBe(true);
    });

    it("should return authorized=false when no tokens exist", async () => {
      const tokenStore = new TokenStore(join(FIXTURE_DIR, "token.json"));
      const app = createTestAuthApp(
        {
          client_id: "test-id",
          client_secret: "test-secret",
          redirect_uri: "http://localhost:3000/auth/callback",
        },
        tokenStore
      );

      const res = await app.request("/auth/status");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.authorized).toBe(false);
    });
  });
});
