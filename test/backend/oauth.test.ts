import { describe, it, expect, beforeEach, mock } from "bun:test";
import { OAuthClient } from "@backend/auth/oauth";
import { TokenStore } from "@backend/auth/token-store";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const FIXTURE_DIR = join(tmpdir(), "gmail-sweep-oauth-test");

beforeEach(() => {
  mkdirSync(FIXTURE_DIR, { recursive: true });
});

const mockCredentials = {
  client_id: "test-client-id",
  client_secret: "test-client-secret",
  redirect_uri: "http://localhost:3000/auth/callback",
};

describe("OAuth flow", () => {
  describe("getAuthorizationUrl", () => {
    it("should build a Google OAuth URL with client_id, redirect_uri, scope, and state", () => {
      const tokenStore = new TokenStore(join(FIXTURE_DIR, "token.json"));
      const oauth = new OAuthClient(mockCredentials, tokenStore);
      const url = new URL(oauth.getAuthorizationUrl());

      expect(url.hostname).toBe("accounts.google.com");
      expect(url.pathname).toBe("/o/oauth2/v2/auth");
      expect(url.searchParams.get("client_id")).toBe("test-client-id");
      expect(url.searchParams.get("redirect_uri")).toBe(
        "http://localhost:3000/auth/callback"
      );
      expect(url.searchParams.get("scope")).toBeDefined();
      expect(url.searchParams.get("state")).toBeDefined();
    });

    it("should include PKCE code_challenge and code_challenge_method", () => {
      const tokenStore = new TokenStore(join(FIXTURE_DIR, "token.json"));
      const oauth = new OAuthClient(mockCredentials, tokenStore);
      const url = new URL(oauth.getAuthorizationUrl());

      expect(url.searchParams.get("code_challenge")).toBeDefined();
      expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    });

    it("should generate and store a random state parameter", () => {
      const tokenStore = new TokenStore(join(FIXTURE_DIR, "token.json"));
      const oauth = new OAuthClient(mockCredentials, tokenStore);
      const url1 = new URL(oauth.getAuthorizationUrl());
      const state1 = url1.searchParams.get("state");
      const url2 = new URL(oauth.getAuthorizationUrl());
      const state2 = url2.searchParams.get("state");

      expect(state1).not.toBe(state2);
    });

    it("should include all required Gmail scopes (readonly, modify)", () => {
      const tokenStore = new TokenStore(join(FIXTURE_DIR, "token.json"));
      const oauth = new OAuthClient(mockCredentials, tokenStore);
      const url = new URL(oauth.getAuthorizationUrl());
      const scope = url.searchParams.get("scope")!;

      expect(scope).toContain("https://www.googleapis.com/auth/gmail.readonly");
      expect(scope).toContain("https://www.googleapis.com/auth/gmail.modify");
    });
  });

  describe("exchangeCode", () => {
    it("should POST to Google token endpoint with code, client_id, client_secret, redirect_uri, and code_verifier", async () => {
      const tokenStore = new TokenStore(join(FIXTURE_DIR, "token.json"));
      const oauth = new OAuthClient(mockCredentials, tokenStore);

      // Get auth URL to set state and code_verifier
      const authUrl = oauth.getAuthorizationUrl();
      const state = new URL(authUrl).searchParams.get("state")!;

      // Mock fetch
      const originalFetch = globalThis.fetch;
      globalThis.fetch = mock(async (url: string, opts: any) => {
        const u = new URL(url);
        expect(u.hostname).toBe("oauth2.googleapis.com");
        expect(u.pathname).toBe("/token");
        expect(opts.method).toBe("POST");
        const body = JSON.parse(opts.body);
        expect(body.code).toBe("test-code");
        expect(body.client_id).toBe("test-client-id");
        expect(body.client_secret).toBe("test-client-secret");
        expect(body.code_verifier).toBeDefined();

        return new Response(
          JSON.stringify({
            access_token: "at-123",
            refresh_token: "rt-456",
            expires_in: 3600,
          })
        );
      }) as any;

      const result = await oauth.exchangeCode("test-code", state);
      expect(result.access_token).toBe("at-123");
      expect(result.refresh_token).toBe("rt-456");

      globalThis.fetch = originalFetch;
    });

    it("should throw on mismatched state parameter", async () => {
      const tokenStore = new TokenStore(join(FIXTURE_DIR, "token.json"));
      const oauth = new OAuthClient(mockCredentials, tokenStore);
      oauth.getAuthorizationUrl();

      await expect(
        oauth.exchangeCode("test-code", "wrong-state")
      ).rejects.toThrow(/state/i);
    });

    it("should throw on invalid authorization code", async () => {
      const tokenStore = new TokenStore(join(FIXTURE_DIR, "token.json"));
      const oauth = new OAuthClient(mockCredentials, tokenStore);
      const authUrl = oauth.getAuthorizationUrl();
      const state = new URL(authUrl).searchParams.get("state")!;

      const originalFetch = globalThis.fetch;
      globalThis.fetch = mock(async () => {
        return new Response(JSON.stringify({ error: "invalid_grant" }), {
          status: 400,
        });
      }) as any;

      await expect(
        oauth.exchangeCode("bad-code", state)
      ).rejects.toThrow();

      globalThis.fetch = originalFetch;
    });
  });

  describe("refreshAccessToken", () => {
    it("should POST to Google token endpoint with grant_type=refresh_token", async () => {
      const tokenStore = new TokenStore(join(FIXTURE_DIR, "token.json"));
      const oauth = new OAuthClient(mockCredentials, tokenStore);

      const originalFetch = globalThis.fetch;
      globalThis.fetch = mock(async (url: string, opts: any) => {
        const body = JSON.parse(opts.body);
        expect(body.grant_type).toBe("refresh_token");
        expect(body.refresh_token).toBe("rt-old");

        return new Response(
          JSON.stringify({
            access_token: "at-new",
            expires_in: 3600,
          })
        );
      }) as any;

      const result = await oauth.refreshAccessToken("rt-old");
      expect(result.access_token).toBe("at-new");

      globalThis.fetch = originalFetch;
    });

    it("should throw on invalid refresh token", async () => {
      const tokenStore = new TokenStore(join(FIXTURE_DIR, "token.json"));
      const oauth = new OAuthClient(mockCredentials, tokenStore);

      const originalFetch = globalThis.fetch;
      globalThis.fetch = mock(async () => {
        return new Response(JSON.stringify({ error: "invalid_grant" }), {
          status: 400,
        });
      }) as any;

      await expect(
        oauth.refreshAccessToken("bad-rt")
      ).rejects.toThrow();

      globalThis.fetch = originalFetch;
    });
  });

  describe("getValidToken", () => {
    it("should return existing token if not expired", async () => {
      const tokenStore = new TokenStore(join(FIXTURE_DIR, "token.json"));
      tokenStore.save({
        access_token: "at-valid",
        refresh_token: "rt-valid",
        expiry_date: Date.now() + 3600000,
      });
      const oauth = new OAuthClient(mockCredentials, tokenStore);

      const token = await oauth.getValidToken();
      expect(token).not.toBeNull();
      expect(token!.access_token).toBe("at-valid");
    });

    it("should refresh and return new token if expired", async () => {
      const tokenStore = new TokenStore(join(FIXTURE_DIR, "token.json"));
      tokenStore.save({
        access_token: "at-expired",
        refresh_token: "rt-valid",
        expiry_date: Date.now() - 1000,
      });
      const oauth = new OAuthClient(mockCredentials, tokenStore);

      const originalFetch = globalThis.fetch;
      globalThis.fetch = mock(async () => {
        return new Response(
          JSON.stringify({
            access_token: "at-refreshed",
            expires_in: 3600,
          })
        );
      }) as any;

      const token = await oauth.getValidToken();
      expect(token!.access_token).toBe("at-refreshed");

      globalThis.fetch = originalFetch;
    });

    it("should return null if no tokens exist (user not authorized)", async () => {
      const tokenStore = new TokenStore(join(FIXTURE_DIR, "nonexistent.json"));
      const oauth = new OAuthClient(mockCredentials, tokenStore);

      const token = await oauth.getValidToken();
      expect(token).toBeNull();
    });
  });
});
