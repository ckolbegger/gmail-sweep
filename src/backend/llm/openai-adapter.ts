import type { LLMProvider, SummaryResult } from "./provider";
import { buildSummaryPrompt } from "./prompt";

export class OpenAIAdapter implements LLMProvider {
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

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });

    if (!res.ok) {
      throw new Error(
        `OpenAI API error: ${res.status} ${await res.text()}`
      );
    }

    const data = (await res.json()) as {
      choices: { message: { content: string } }[];
    };

    let parsed: {
      summary: string;
      action_items: string[];
      key_points: string[];
    };
    try {
      parsed = JSON.parse(data.choices[0].message.content);
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
