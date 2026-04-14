import { describe, test, expect } from "bun:test";
import { createEmbedProvider } from "../../../src/backend/services/embed-provider";

describe("createEmbedProvider", () => {
  test("openai-compatible returns documented shape", () => {
    const p = createEmbedProvider({
      provider: "openai-compatible",
      model: "test-model",
      dimension: 4,
      api_key: "sk-fake",
      base_url: "http://localhost:9999/v1",
    });
    expect(typeof p.embedDocument).toBe("function");
    expect(typeof p.embedQuery).toBe("function");
  });

  test("unknown provider throws", () => {
    expect(() =>
      createEmbedProvider({ provider: "bogus" as any, model: "x", dimension: 4 })
    ).toThrow(/provider/);
  });
});
