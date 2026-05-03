import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { google } from "googleapis";
import type { AppConfig } from "@gmail-sweep/shared/src/config";
import type { GmailProbeResult, GmailProvider } from "./types";
import { getAccountDir, getAppHome } from "../../config/paths";

export interface GoogleOAuthCredentials {
  clientId: string;
  clientSecret: string;
}

export interface StoredGoogleTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export interface GoogleTokenRefresh {
  accessToken: string;
  expiresAt: number;
}

type Env = Record<string, string | undefined>;

const gmailScope = "https://mail.google.com/";
const testLabelName = "gmail-sweep-test";

export function readGoogleCredentials(env: Env): GoogleOAuthCredentials | null {
  const clientId = env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return null;
  }

  return { clientId, clientSecret };
}

export function createGoogleAuthUrl(credentials: GoogleOAuthCredentials, redirectUri: string): string {
  const client = new google.auth.OAuth2(credentials.clientId, credentials.clientSecret, redirectUri);

  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [gmailScope],
  });
}

export async function exchangeGoogleCodeForTokens(
  code: string,
  env: Env,
  redirectUri: string,
): Promise<StoredGoogleTokens> {
  const credentials = requireGoogleCredentials(env);
  const client = new google.auth.OAuth2(credentials.clientId, credentials.clientSecret, redirectUri);
  const response = await client.getToken(code);
  const tokens = response.tokens;

  if (!tokens.access_token || !tokens.refresh_token || !tokens.expiry_date) {
    throw new Error("Google token response did not include access token, refresh token, and expiry");
  }

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: tokens.expiry_date,
  };
}

export async function refreshGoogleAccessToken(refreshToken: string, env: Env): Promise<GoogleTokenRefresh> {
  const credentials = requireGoogleCredentials(env);
  const client = new google.auth.OAuth2(credentials.clientId, credentials.clientSecret);
  client.setCredentials({ refresh_token: refreshToken });
  const response = await client.refreshAccessToken();
  const tokens = response.credentials;

  if (!tokens.access_token || !tokens.expiry_date) {
    throw new Error("Google refresh response did not include access token and expiry");
  }

  return {
    accessToken: tokens.access_token,
    expiresAt: tokens.expiry_date,
  };
}

export function getGoogleTokensPath(env: Env, accountId: string): string {
  return `${getAccountDir(getAppHome(env), accountId)}/tokens.json`;
}

export function readStoredGoogleTokens(env: Env, accountId: string): StoredGoogleTokens | null {
  const tokenPath = getGoogleTokensPath(env, accountId);

  if (!existsSync(tokenPath)) {
    return null;
  }

  return JSON.parse(readFileSync(tokenPath, "utf8")) as StoredGoogleTokens;
}

export function writeStoredGoogleTokens(env: Env, accountId: string, tokens: StoredGoogleTokens): void {
  const accountDir = getAccountDir(getAppHome(env), accountId);
  mkdirSync(accountDir, { recursive: true });
  writeFileSync(getGoogleTokensPath(env, accountId), `${JSON.stringify(tokens, null, 2)}\n`);
}

export interface GoogleGmailProbe {
  getProfile(): Promise<{ email: string }>;
  findLabel(name: string): Promise<{ id: string; name: string } | null>;
  listMessagesForLabel(labelId: string, maxResults: number): Promise<
    {
      id: string;
      threadId: string;
      subject: string;
      from: string;
      snippet: string;
      labels: string[];
    }[]
  >;
}

interface GmailClient {
  users: {
    getProfile?: (request: { userId: string }) => Promise<{ data: { emailAddress?: string | null } }>;
    labels?: {
      list(request: { userId: string }): Promise<{
        data: { labels?: { id?: string | null; name?: string | null }[] | null };
      }>;
    };
    messages: {
      list(request: { userId: string; labelIds: string[]; maxResults: number }): Promise<{
        data: { messages?: { id?: string | null }[] | null };
      }>;
      get(request: {
        userId: string;
        id: string;
        format: "metadata";
        metadataHeaders: string[];
      }): Promise<{
        data: {
          id?: string | null;
          threadId?: string | null;
          snippet?: string | null;
          labelIds?: string[] | null;
          payload?: { headers?: { name?: string | null; value?: string | null }[] | null } | null;
        };
      }>;
    };
  };
}

export function createGoogleGmailProbe(env: Env, accountId: string): GoogleGmailProbe {
  const tokens = readStoredGoogleTokens(env, accountId);

  if (!tokens) {
    throw new Error("Active account is not authenticated with Google");
  }

  const credentials = requireGoogleCredentials(env);
  const client = new google.auth.OAuth2(credentials.clientId, credentials.clientSecret);
  client.setCredentials({
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
    expiry_date: tokens.expiresAt,
  });

  const gmail = google.gmail({ version: "v1", auth: client });

  return createGoogleGmailProbeFromClient(gmail);
}

export function createGoogleGmailProbeFromClient(gmail: GmailClient): GoogleGmailProbe {
  return {
    async getProfile() {
      if (!gmail.users.getProfile) {
        throw new Error("Gmail profile API is unavailable");
      }

      const response = await gmail.users.getProfile({ userId: "me" });
      return { email: response.data.emailAddress ?? "" };
    },
    async findLabel(name) {
      if (!gmail.users.labels) {
        throw new Error("Gmail labels API is unavailable");
      }

      const response = await gmail.users.labels.list({ userId: "me" });
      const label = response.data.labels?.find((candidate) => candidate.name === name);

      if (!label?.id || !label.name) {
        return null;
      }

      return { id: label.id, name: label.name };
    },
    async listMessagesForLabel(labelId, maxResults) {
      const response = await gmail.users.messages.list({
        userId: "me",
        labelIds: ["INBOX", labelId],
        maxResults,
      });
      const messages = response.data.messages ?? [];

      return Promise.all(
        messages.map(async (message) => {
          const detail = await gmail.users.messages.get({
            userId: "me",
            id: message.id ?? "",
            format: "metadata",
            metadataHeaders: ["Subject", "From"],
          });
          const headers = detail.data.payload?.headers ?? [];

          return {
            id: detail.data.id ?? "",
            threadId: detail.data.threadId ?? "",
            subject: headers.find((header) => header.name?.toLowerCase() === "subject")?.value ?? "",
            from: headers.find((header) => header.name?.toLowerCase() === "from")?.value ?? "",
            snippet: detail.data.snippet ?? "",
            labels: detail.data.labelIds ?? [],
          };
        }),
      );
    },
  };
}

export function createGoogleGmailProvider(config: AppConfig, env: Env = process.env): GmailProvider {
  return {
    async probe(): Promise<GmailProbeResult> {
      const accountId = config.activeAccountId ?? "";

      if (!accountId) {
        return blockedProbe(accountId, "Missing active account");
      }

      if (!readGoogleCredentials(env)) {
        return blockedProbe(accountId, "Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET");
      }

      try {
        const probe = createGoogleGmailProbe(env, accountId);
        const profile = await probe.getProfile();
        const label = await probe.findLabel(testLabelName);

        if (!label) {
          return blockedProbe(accountId, `Missing Gmail label ${testLabelName}`, profile.email);
        }

        const messages = await probe.listMessagesForLabel(label.id, 3);

        if (messages.length === 0) {
          return blockedProbe(accountId, `No read-only acceptance messages found in ${testLabelName}`, profile.email);
        }

        return {
          provider: "google",
          status: "PASS" as GmailProbeResult["status"],
          account: {
            id: accountId,
            email: profile.email,
            authenticated: true,
          },
          label,
          messages,
        };
      } catch (error) {
        return blockedProbe(accountId, error instanceof Error ? error.message : "Google Gmail probe failed");
      }
    },
  };
}

function requireGoogleCredentials(env: Env): GoogleOAuthCredentials {
  const credentials = readGoogleCredentials(env);

  if (!credentials) {
    throw new Error("Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET");
  }

  return credentials;
}

function blockedProbe(accountId: string, message: string, email = ""): GmailProbeResult {
  return {
    provider: "google",
    status: "BLOCKED" as GmailProbeResult["status"],
    account: {
      id: accountId,
      email,
      authenticated: false,
    },
    label: {
      id: "",
      name: "",
    },
    messages: [],
    message,
  } as GmailProbeResult;
}
