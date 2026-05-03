import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../packages/backend/src/config/load";

const tempHomes: string[] = [];

function makeHome() {
  const home = mkdtempSync(join(tmpdir(), "gmail-sweep-config-"));
  tempHomes.push(home);
  return home;
}

afterEach(() => {
  for (const home of tempHomes.splice(0)) {
    rmSync(home, { recursive: true, force: true });
  }
});

describe("app config loading", () => {
  test("it should default sync.maxMessagesPerFetch to 100", () => {
    const home = makeHome();

    const config = loadConfig({ GMAIL_SWEEP_HOME: home });

    expect(config.sync.maxMessagesPerFetch).toBe(100);
  });

  test("it should keep AI secrets as environment variable references", () => {
    const home = makeHome();
    writeFileSync(
      join(home, "config.json"),
      JSON.stringify({
        ai: {
          provider: "openai",
          model: "gpt-5-mini",
          apiKeyEnv: "OPENAI_API_KEY",
        },
      }),
    );

    const config = loadConfig({ GMAIL_SWEEP_HOME: home });

    expect(config.ai).toEqual({
      provider: "openai",
      model: "gpt-5-mini",
      apiKeyEnv: "OPENAI_API_KEY",
    });
    expect(config.ai).not.toHaveProperty("apiKey");
  });

  test("it should load active account and provider mode from config", () => {
    const home = makeHome();
    writeFileSync(
      join(home, "config.json"),
      JSON.stringify({
        activeAccountId: "account-1",
        gmail: { provider: "google" },
        dev: { provider: "fakeGmail", scenario: "seeded" },
        ai: { provider: "anthropic", model: "claude-sonnet-4-5", apiKeyEnv: "ANTHROPIC_API_KEY" },
      }),
    );

    const config = loadConfig({ GMAIL_SWEEP_HOME: home });

    expect(config.activeAccountId).toBe("account-1");
    expect(config.gmail.provider).toBe("google");
    expect(config.dev.provider).toBe("fakeGmail");
    expect(config.dev.scenario).toBe("seeded");
    expect(config.ai.provider).toBe("anthropic");
    expect(config.ai.model).toBe("claude-sonnet-4-5");
    expect(config.ai.apiKeyEnv).toBe("ANTHROPIC_API_KEY");
  });
});
