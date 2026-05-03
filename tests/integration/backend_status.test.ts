import { describe, expect, test } from "bun:test";
import { createApp } from "../../packages/backend/src/app";
import type { AppConfig } from "../../packages/shared/src/config";

const fakeConfig: AppConfig = {
  activeAccountId: "fake-account-1",
  gmail: { provider: "fakeGmail" },
  sync: { maxMessagesPerFetch: 100 },
  ai: { provider: "fakeAI", model: "fake-summary" },
  dev: { provider: "fakeGmail", scenario: "seeded" },
  backend: { host: "127.0.0.1", port: 3000 },
};

describe("backend status route", () => {
  test("it should return ok, version, provider mode, and active account status", async () => {
    const app = createApp({ config: fakeConfig });

    const response = await app.request("/status");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      version: "0.1.0",
      providerMode: "fakeGmail",
      providerModes: {
        gmail: "fakeGmail",
        ai: "fakeAI",
      },
      activeAccount: {
        id: "fake-account-1",
        authenticated: true,
      },
    });
  });
});
