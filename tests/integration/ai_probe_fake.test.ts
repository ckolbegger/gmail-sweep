import { describe, expect, test } from "bun:test";
import { createApp } from "../../packages/backend/src/app";
import { createAnthropicAiProvider } from "../../packages/backend/src/providers/ai/anthropic";
import { createOpenAiProvider } from "../../packages/backend/src/providers/ai/openai";
import type { AppConfig } from "../../packages/shared/src/config";

const baseConfig: AppConfig = {
  activeAccountId: "fake-account-1",
  gmail: { provider: "fakeGmail" },
  sync: { maxMessagesPerFetch: 100 },
  ai: { provider: "fakeAI", model: "fake-summary" },
  dev: { provider: "fakeGmail", scenario: "seeded" },
  backend: { host: "127.0.0.1", port: 3000 },
};

function configFor(ai: AppConfig["ai"]): AppConfig {
  return { ...baseConfig, ai };
}

describe("ai provider probes", () => {
  test("it should select the configured fake, OpenAI, or Anthropic provider", async () => {
    const fake = createApp({ config: configFor({ provider: "fakeAI", model: "fake-summary" }) });
    const openai = createApp({ config: configFor({ provider: "openai", model: "gpt-test" }) });
    const anthropic = createApp({ config: configFor({ provider: "anthropic", model: "claude-test" }) });

    const fakeResponse = await fake.request("/providers/ai/probe", { method: "POST" });
    const openaiResponse = await openai.request("/providers/ai/probe", { method: "POST" });
    const anthropicResponse = await anthropic.request("/providers/ai/probe", { method: "POST" });

    expect(fakeResponse.status).toBe(200);
    expect(openaiResponse.status).toBe(200);
    expect(anthropicResponse.status).toBe(200);
    expect(await fakeResponse.json()).toMatchObject({ provider: "fakeAI", status: "ok" });
    expect(await openaiResponse.json()).toMatchObject({ provider: "openai", status: "not-configured" });
    expect(await anthropicResponse.json()).toMatchObject({ provider: "anthropic", status: "not-configured" });
  });

  test("it should return BLOCKED when required provider credentials are missing", async () => {
    const openai = createApp({ config: configFor({ provider: "openai", model: "gpt-test" }) });
    const anthropic = createApp({ config: configFor({ provider: "anthropic", model: "claude-test" }) });

    const openaiBody = await openai.request("/providers/ai/probe", { method: "POST" }).then((r) => r.json());
    const anthropicBody = await anthropic.request("/providers/ai/probe", { method: "POST" }).then((r) => r.json());

    expect(openaiBody).toMatchObject({
      provider: "openai",
      status: "not-configured",
      message: "Missing OPENAI_API_KEY",
    });
    expect(anthropicBody).toMatchObject({
      provider: "anthropic",
      status: "not-configured",
      message: "Missing ANTHROPIC_API_KEY",
    });
  });

  test("it should send a tiny bounded OpenAI probe when configured", async () => {
    const requests: unknown[] = [];
    const provider = createOpenAiProvider(
      configFor({ provider: "openai", model: "gpt-test" }),
      { OPENAI_API_KEY: "test-openai-key" },
      {
        responses: {
          async create(request: unknown) {
            requests.push(request);
            return { output_text: "OpenAI probe summary." };
          },
        },
      },
    );

    const result = await provider.probe();

    expect(result).toMatchObject({
      provider: "openai",
      status: "ok",
      model: "gpt-test",
      summary: { description: "OpenAI probe summary." },
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      model: "gpt-test",
      max_output_tokens: 64,
      temperature: 0,
    });
  });

  test("it should send a tiny bounded Anthropic probe when configured", async () => {
    const requests: unknown[] = [];
    const provider = createAnthropicAiProvider(
      configFor({ provider: "anthropic", model: "claude-test" }),
      { ANTHROPIC_API_KEY: "test-anthropic-key" },
      {
        messages: {
          async create(request: unknown) {
            requests.push(request);
            return { content: [{ type: "text", text: "Anthropic probe summary." }] };
          },
        },
      },
    );

    const result = await provider.probe();

    expect(result).toMatchObject({
      provider: "anthropic",
      status: "ok",
      model: "claude-test",
      summary: { description: "Anthropic probe summary." },
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      model: "claude-test",
      max_tokens: 64,
      temperature: 0,
    });
  });

  test("it should surface provider errors without crashing the backend", async () => {
    const app = createApp({
      config: configFor({ provider: "openai", model: "gpt-test" }),
      aiProvider: createOpenAiProvider(
        configFor({ provider: "openai", model: "gpt-test" }),
        { OPENAI_API_KEY: "test-openai-key" },
        {
          responses: {
            async create() {
              throw new Error("provider unavailable");
            },
          },
        },
      ),
    });

    const response = await app.request("/providers/ai/probe", { method: "POST" });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      provider: "openai",
      status: "failed",
      message: "provider unavailable",
    });
  });
});
