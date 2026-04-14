import { describe, test, expect } from "bun:test";
import { OpenAIAdapter } from "../../../src/backend/llm/openai-adapter";

describe("LLMProvider.parseSearchQuery", () => {
  test("returns ParsedQuery shape", async () => {
    const adapter = new OpenAIAdapter({ apiKey: "sk", model: "gpt-4o-mini", baseUrl: "http://localhost:1" });
    // Stub the internal fetch to return a parsed query
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"filters":{"sender":"alice"},"semanticQuery":"invoice"}' } }],
        }),
        { headers: { "content-type": "application/json" } }
      );
    };

    try {
      const p = await adapter.parseSearchQuery("from alice about invoice");
      expect(p.filters.sender).toBe("alice");
      expect(p.semanticQuery).toBe("invoice");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
