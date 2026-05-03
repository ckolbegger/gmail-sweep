import type { AiProviderMode, GmailProviderMode, ProviderProbeStatus } from "@gmail-sweep/shared/src/provider";

export interface BackendStatus {
  ok: true;
  version: string;
  providerMode: GmailProviderMode;
  providerModes: {
    gmail: GmailProviderMode;
    ai: AiProviderMode;
  };
  activeAccount: {
    id: string | null;
    authenticated: boolean;
  };
}

export interface AuthStatus {
  provider: "google";
  authenticated: boolean;
  accountId: string;
}

export type ProbeResultStatus = ProviderProbeStatus | "PASS" | "BLOCKED" | "blocked";

export interface ProbeResult {
  provider: GmailProviderMode | AiProviderMode;
  status: ProbeResultStatus;
  message?: string;
  [key: string]: unknown;
}

export interface ApiClient {
  getStatus(): Promise<BackendStatus>;
  getAuthStatus(): Promise<AuthStatus>;
  probeGmail(): Promise<ProbeResult>;
  probeAi(): Promise<ProbeResult>;
}

export function createApiClient(baseUrl: string, fetchApi: typeof fetch = fetch): ApiClient {
  return {
    getStatus: () => getJson<BackendStatus>(fetchApi, `${baseUrl}/status`),
    getAuthStatus: () => getJson<AuthStatus>(fetchApi, `${baseUrl}/auth/status`),
    probeGmail: () => postJson<ProbeResult>(fetchApi, `${baseUrl}/providers/gmail/probe`),
    probeAi: () => postJson<ProbeResult>(fetchApi, `${baseUrl}/providers/ai/probe`),
  };
}

async function getJson<T>(fetchApi: typeof fetch, url: string): Promise<T> {
  const response = await fetchApi(url);
  return readJson<T>(response, url);
}

async function postJson<T>(fetchApi: typeof fetch, url: string): Promise<T> {
  const response = await fetchApi(url, { method: "POST" });
  return readJson<T>(response, url);
}

async function readJson<T>(response: Response, url: string): Promise<T> {
  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}`);
  }

  return (await response.json()) as T;
}
