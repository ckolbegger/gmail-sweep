import type { LLMProvider, SummaryResult } from "./provider";
import { buildSummaryPrompt } from "./prompt";

export class AnthropicAdapter implements LLMProvider {
  private baseUrl: string;
  private apiKey: string;
  private model: string;

  constructor(opts: { baseUrl: string; apiKey: string; model: string }) {
    this.baseUrl = opts.baseUrl;
    this.apiKey = opts.apiKey;
    this.model = opts.model;
  }

  async summarize(email: {
    sender: string;
    subject: string;
    body: string;
  }): Promise<SummaryResult> {
    const { system, user } = buildSummaryPrompt(email);

    const res = await fetch(`${this.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 1024,
        system,
        messages: [{ role: "user", content: user }],
      }),
    });

    if (!res.ok) {
      throw new Error(
        `Anthropic API error: ${res.status} ${await res.text()}`
      );
    }

    const data = (await res.json()) as {
      content: { type: string; text: string }[];
    };

    const textBlock = data.content.find((b) => b.type === "text");
    if (!textBlock) {
      throw new Error("No text content block in Anthropic response");
    }

    let parsed: {
      summary: string;
      action_items: string[];
      key_points: string[];
    };
    try {
      parsed = JSON.parse(textBlock.text);
    } catch {
      throw new Error("Failed to parse LLM response as JSON");
    }

    return {
      summary: parsed.summary,
      actionItems: parsed.action_items,
      keyPoints: parsed.key_points,
      model: this.model,
    };
  }
}
