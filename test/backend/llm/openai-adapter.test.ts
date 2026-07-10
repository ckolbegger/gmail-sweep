import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { OpenAIAdapter } from "@backend/llm/openai-adapter";

describe("OpenAIAdapter", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function createAdapter() {
    return new OpenAIAdapter({
      baseUrl: "https://api.example.com",
      apiKey: "sk-test",
      model: "gpt-4o-mini",
    });
  }

  const email = {
    sender: "bob@example.com",
    subject: "Meeting Tomorrow",
    body: "Let's meet at 3pm in conference room B.",
  };

  const fakeResponse = {
    summary: "Bob invited you to a meeting at 3pm in conference room B.",
    action_items: ["Attend meeting at 3pm in room B"],
    key_points: ["Meeting scheduled for tomorrow at 3pm"],
  };

  it("should POST to {baseUrl}/chat/completions", async () => {
    const adapter = createAdapter();
    let calledUrl = "";
    globalThis.fetch = mock(async (url: string) => {
      calledUrl = url;
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: { content: JSON.stringify(fakeResponse) },
            },
          ],
        })
      );
    }) as any;

    await adapter.summarize(email);
    expect(calledUrl).toBe("https://api.example.com/chat/completions");
  });

  it("should send model and messages in request body", async () => {
    const adapter = createAdapter();
    let requestBody: any;
    globalThis.fetch = mock(async (_url: string, opts: any) => {
      requestBody = JSON.parse(opts.body);
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: { content: JSON.stringify(fakeResponse) },
            },
          ],
        })
      );
    }) as any;

    await adapter.summarize(email);
    expect(requestBody.model).toBe("gpt-4o-mini");
    expect(requestBody.messages).toBeDefined();
    expect(requestBody.messages.length).toBeGreaterThan(0);
  });

  it("should include system message and user message with email fields", async () => {
    const adapter = createAdapter();
    let requestBody: any;
    globalThis.fetch = mock(async (_url: string, opts: any) => {
      requestBody = JSON.parse(opts.body);
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: { content: JSON.stringify(fakeResponse) },
            },
          ],
        })
      );
    }) as any;

    await adapter.summarize(email);
    const messages = requestBody.messages;
    const systemMsg = messages.find((m: any) => m.role === "system");
    const userMsg = messages.find((m: any) => m.role === "user");
    expect(systemMsg).toBeDefined();
    expect(userMsg).toBeDefined();
    expect(userMsg.content).toContain("bob@example.com");
    expect(userMsg.content).toContain("Meeting Tomorrow");
  });

  it("should send Authorization header with Bearer token", async () => {
    const adapter = createAdapter();
    let headers: any;
    globalThis.fetch = mock(async (_url: string, opts: any) => {
      headers = opts.headers;
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: { content: JSON.stringify(fakeResponse) },
            },
          ],
        })
      );
    }) as any;

    await adapter.summarize(email);
    expect(headers.Authorization).toBe("Bearer sk-test");
  });

  it("should parse JSON from response.choices[0].message.content and return SummaryResult", async () => {
    const adapter = createAdapter();
    globalThis.fetch = mock(async () => {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: { content: JSON.stringify(fakeResponse) },
            },
          ],
        })
      );
    }) as any;

    const result = await adapter.summarize(email);
    expect(result.summary).toBe(fakeResponse.summary);
    expect(result.actionItems).toEqual(fakeResponse.action_items);
    expect(result.keyPoints).toEqual(fakeResponse.key_points);
    expect(result.model).toBe("gpt-4o-mini");
  });

  it("should throw on non-OK HTTP response", async () => {
    const adapter = createAdapter();
    globalThis.fetch = mock(async () => {
      return new Response("Internal Server Error", { status: 500 });
    }) as any;

    await expect(adapter.summarize(email)).rejects.toThrow();
  });

  it("should throw when response has no valid JSON in content", async () => {
    const adapter = createAdapter();
    globalThis.fetch = mock(async () => {
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "not valid json" } }],
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
        JSON.stringify({ choices: [{ message: { content: JSON.stringify(fakeResponse) } }] })
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
        JSON.stringify({ choices: [{ message: { content: '{"filters":{},"semanticQuery":"invoices"}' } }] })
      );
    }) as any;
    await adapter.parseSearchQuery("invoices");
    expect(requestBody.max_tokens).toBeGreaterThanOrEqual(2048);
  });
});
