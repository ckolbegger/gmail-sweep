import { randomBytes, createHash } from "node:crypto";
import { TokenStore, type Tokens } from "./token-store";

export interface Credentials {
  client_id: string;
  client_secret: string;
  redirect_uri: string;
}

interface PKCE {
  verifier: string;
  challenge: string;
}

function base64URLEncode(buffer: Buffer): string {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function generatePKCE(): PKCE {
  const verifier = base64URLEncode(randomBytes(32));
  const challenge = base64URLEncode(
    createHash("sha256").update(verifier).digest()
  );
  return { verifier, challenge };
}

export class OAuthClient {
  private credentials: Credentials;
  private tokenStore: TokenStore;
  private state: string | null = null;
  private pkce: PKCE | null = null;

  constructor(credentials: Credentials, tokenStore: TokenStore) {
    this.credentials = credentials;
    this.tokenStore = tokenStore;
  }

  getAuthorizationUrl(): string {
    this.state = base64URLEncode(randomBytes(16));
    this.pkce = generatePKCE();

    const params = new URLSearchParams({
      client_id: this.credentials.client_id,
      redirect_uri: this.credentials.redirect_uri,
      response_type: "code",
      scope: [
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/gmail.modify",
      ].join(" "),
      state: this.state,
      code_challenge: this.pkce.challenge,
      code_challenge_method: "S256",
      access_type: "offline",
      prompt: "consent",
    });

    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  }

  async exchangeCode(code: string, state: string): Promise<Tokens> {
    if (state !== this.state) {
      throw new Error("State parameter mismatch");
    }

    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code,
        client_id: this.credentials.client_id,
        client_secret: this.credentials.client_secret,
        redirect_uri: this.credentials.redirect_uri,
        grant_type: "authorization_code",
        code_verifier: this.pkce!.verifier,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "unknown" }));
      throw new Error(`Token exchange failed: ${err.error}`);
    }

    const data = (await res.json()) as any;
    const tokens: Tokens = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expiry_date: Date.now() + data.expires_in * 1000,
    };
    this.tokenStore.save(tokens);
    return tokens;
  }

  async refreshAccessToken(refreshToken: string): Promise<Tokens> {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        refresh_token: refreshToken,
        client_id: this.credentials.client_id,
        client_secret: this.credentials.client_secret,
        grant_type: "refresh_token",
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "unknown" }));
      throw new Error(`Token refresh failed: ${err.error}`);
    }

    const data = (await res.json()) as any;
    const existing = this.tokenStore.load();
    const tokens: Tokens = {
      access_token: data.access_token,
      refresh_token: data.refresh_token ?? existing?.refresh_token ?? refreshToken,
      expiry_date: Date.now() + data.expires_in * 1000,
    };
    this.tokenStore.save(tokens);
    return tokens;
  }

  async getValidToken(): Promise<Tokens | null> {
    const tokens = this.tokenStore.load();
    if (!tokens) return null;

    if (this.tokenStore.isExpired()) {
      return this.refreshAccessToken(tokens.refresh_token);
    }

    return tokens;
  }
}
