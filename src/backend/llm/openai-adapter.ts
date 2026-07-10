import type { LLMProvider, SummaryResult, ParsedQuery } from "./provider";
import { MIN_MAX_TOKENS } from "./provider";
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

    const requestBody = {
      model: this.model,
      max_tokens: MIN_MAX_TOKENS,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    };

    console.log("[LLM] OpenAI request:", JSON.stringify(requestBody, null, 2));

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error("[LLM] OpenAI error response:", res.status, errorText);
      throw new Error(`OpenAI API error: ${res.status} ${errorText}`);
    }

    const data = (await res.json()) as {
      choices: { message: { content: string } }[];
    };

    console.log("[LLM] OpenAI response:", JSON.stringify(data, null, 2));

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

  async parseSearchQuery(query: string): Promise<ParsedQuery> {
    const prompt = `Parse this email search query. Return ONLY JSON:
{"filters":{"sender":"<omit if absent>","date_from":"<ISO>","date_to":"<ISO>","subject":"<keywords>"},"semanticQuery":"<remaining topic>"}
Today is ${new Date().toISOString().split("T")[0]}.
Query: "${query}"`;

    const requestBody = {
      model: this.model,
      max_tokens: MIN_MAX_TOKENS,
      messages: [
        { role: "system", content: "You parse email search queries into structured JSON. Return ONLY valid JSON, no other text." },
        { role: "user", content: prompt },
      ],
    };

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`OpenAI API error: ${res.status} ${errorText}`);
    }

    const data = (await res.json()) as {
      choices: { message: { content: string } }[];
    };

    const text = data.choices[0].message.content;
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("no JSON in LLM response");
    return JSON.parse(match[0]) as ParsedQuery;
  }
}
