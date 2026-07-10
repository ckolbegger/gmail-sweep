import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { AnthropicAdapter } from "@backend/llm/anthropic-adapter";

describe("AnthropicAdapter", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function createAdapter() {
    return new AnthropicAdapter({
      baseUrl: "https://api.anthropic.com",
      apiKey: "sk-ant-test",
      model: "claude-sonnet-4-20250514",
    });
  }

  const email = {
    sender: "carol@example.com",
    subject: "Quarterly Report",
    body: "Q3 revenue exceeded expectations by 12%.",
  };

  const fakeResponse = {
    summary: "Carol reported that Q3 revenue exceeded expectations by 12%.",
    action_items: ["Review the full quarterly report"],
    key_points: ["Q3 revenue exceeded expectations by 12%"],
  };

  it("should POST to {baseUrl}/v1/messages", async () => {
    const adapter = createAdapter();
    let calledUrl = "";
    globalThis.fetch = mock(async (url: string) => {
      calledUrl = url;
      return new Response(
        JSON.stringify({
          content: [{ type: "text", text: JSON.stringify(fakeResponse) }],
        })
      );
    }) as any;

    await adapter.summarize(email);
    expect(calledUrl).toBe("https://api.anthropic.com/v1/messages");
  });

  it("should use Anthropic API format with system as top-level param", async () => {
    const adapter = createAdapter();
    let requestBody: any;
    globalThis.fetch = mock(async (_url: string, opts: any) => {
      requestBody = JSON.parse(opts.body);
      return new Response(
        JSON.stringify({
          content: [{ type: "text", text: JSON.stringify(fakeResponse) }],
        })
      );
    }) as any;

    await adapter.summarize(email);
    expect(requestBody.system).toBeDefined();
    expect(typeof requestBody.system).toBe("string");
    expect(requestBody.messages).toBeDefined();
  });

  it("should send model and messages array with user role", async () => {
    const adapter = createAdapter();
    let requestBody: any;
    globalThis.fetch = mock(async (_url: string, opts: any) => {
      requestBody = JSON.parse(opts.body);
      return new Response(
        JSON.stringify({
          content: [{ type: "text", text: JSON.stringify(fakeResponse) }],
        })
      );
    }) as any;

    await adapter.summarize(email);
    expect(requestBody.model).toBe("claude-sonnet-4-20250514");
    expect(requestBody.messages).toHaveLength(1);
    expect(requestBody.messages[0].role).toBe("user");
    expect(requestBody.messages[0].content).toContain("carol@example.com");
  });

  it("should send x-api-key header and anthropic-version", async () => {
    const adapter = createAdapter();
    let headers: any;
    globalThis.fetch = mock(async (_url: string, opts: any) => {
      headers = opts.headers;
      return new Response(
        JSON.stringify({
          content: [{ type: "text", text: JSON.stringify(fakeResponse) }],
        })
      );
    }) as any;

    await adapter.summarize(email);
    expect(headers["x-api-key"]).toBe("sk-ant-test");
    expect(headers["anthropic-version"]).toBeDefined();
  });

  it("should parse content block text as JSON and return SummaryResult", async () => {
    const adapter = createAdapter();
    globalThis.fetch = mock(async () => {
      return new Response(
        JSON.stringify({
          content: [{ type: "text", text: JSON.stringify(fakeResponse) }],
        })
      );
    }) as any;

    const result = await adapter.summarize(email);
    expect(result.summary).toBe(fakeResponse.summary);
    expect(result.actionItems).toEqual(fakeResponse.action_items);
    expect(result.keyPoints).toEqual(fakeResponse.key_points);
    expect(result.model).toBe("claude-sonnet-4-20250514");
  });

  it("should throw on non-OK HTTP response", async () => {
    const adapter = createAdapter();
    globalThis.fetch = mock(async () => {
      return new Response("Unauthorized", { status: 401 });
    }) as any;

    await expect(adapter.summarize(email)).rejects.toThrow();
  });

  it("should throw when response has no valid JSON in content block", async () => {
    const adapter = createAdapter();
    globalThis.fetch = mock(async () => {
      return new Response(
        JSON.stringify({
          content: [{ type: "text", text: "not valid json" }],
        })
      );
    }) as any;

    await expect(adapter.summarize(email)).rejects.toThrow();
  });

  it("summarize sends max_tokens >= 2048 (LAN proxy floor)", async () => {
    const adapter = createAdapter();
    let requestBody: any;
    globalThis.fetch = mock(async (_u: string, opts: any) => {
      requestBody = JSON.parse(opts.body);
      return new Response(
        JSON.stringify({ content: [{ type: "text", text: JSON.stringify(fakeResponse) }] })
      );
    }) as any;
    await adapter.summarize(email);
    expect(requestBody.max_tokens).toBeGreaterThanOrEqual(2048);
  });

  it("parseSearchQuery sends max_tokens >= 2048", async () => {
    const adapter = createAdapter();
    let requestBody: any;
    globalThis.fetch = mock(async (_u: string, opts: any) => {
      requestBody = JSON.parse(opts.body);
      return new Response(
        JSON.stringify({ content: [{ type: "text", text: '{"filters":{},"semanticQuery":"invoices"}' }] })
      );
    }) as any;
    await adapter.parseSearchQuery("invoices");
    expect(requestBody.max_tokens).toBeGreaterThanOrEqual(2048);
  });
});
