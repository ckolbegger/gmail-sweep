import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import type { LLMConfig, EmailSummary, ParsedQuery } from '@gmail-sweep/shared';
import { stripUrls, BODY_MAX_CHARS } from './content.js';

export interface AiService {
  summarizeEmail(bodyText: string): Promise<EmailSummary>;
  parseSearchQuery(query: string): Promise<ParsedQuery>;
}

const SUMMARY_PROMPT = (body: string) => `
Summarize this email. Return ONLY valid JSON with this exact shape:
{
  "description": "<one sentence>",
  "actionItems": ["<item>"],
  "keyPoints": ["<point>"]
}

Email:
${body}
`.trim();

const PARSE_QUERY_PROMPT = (query: string) => `
Parse this email search query into structured filters and a semantic query.
Return ONLY valid JSON with this exact shape:
{
  "filters": {
    "sender": "<email or name, omit if not mentioned>",
    "date_from": "<ISO 8601 date, omit if not mentioned>",
    "date_to": "<ISO 8601 date, omit if not mentioned>",
    "subject": "<only if the user explicitly refers to the subject line, omit otherwise>"
  },
  "semanticQuery": "<the remaining topic/content to search for>"
}

Topics and content belong in semanticQuery, NOT in the subject filter.

Today is ${new Date().toISOString().split('T')[0]}.
Query: "${query}"
`.trim();

// Reasoning models spend hidden thinking tokens before emitting text; long
// noisy inputs can push that past 2k, truncating output to empty content.
const MAX_TOKENS = 4096;

function parseJson<T>(text: string): T {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`No JSON found in response: ${text}`);
  return JSON.parse(match[0]) as T;
}

export function createAiService(llmConfig: LLMConfig): AiService {
  const anthropicClient = llmConfig.provider === 'anthropic'
    ? new Anthropic({ apiKey: llmConfig.apiKey, ...(llmConfig.baseUrl ? { baseURL: llmConfig.baseUrl } : {}) })
    : null;
  const openAiClient = llmConfig.provider !== 'anthropic'
    ? new OpenAI({ apiKey: llmConfig.apiKey, baseURL: llmConfig.baseUrl })
    : null;

  return {
    async summarizeEmail(bodyText) {
      const prompt = SUMMARY_PROMPT(stripUrls(bodyText).slice(0, BODY_MAX_CHARS));

      if (anthropicClient) {
        const response = await anthropicClient.messages.create({
          model: llmConfig.model,
          max_tokens: MAX_TOKENS,
          messages: [{ role: 'user', content: prompt }],
        });
        const text = response.content.find(b => b.type === 'text')?.text ?? '';
        return parseJson<EmailSummary>(text);
      }

      const response = await openAiClient!.chat.completions.create({
        model: llmConfig.model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: MAX_TOKENS,
      });
      return parseJson<EmailSummary>(response.choices[0]?.message.content ?? '');
    },

    async parseSearchQuery(query) {
      const prompt = PARSE_QUERY_PROMPT(query);

      if (anthropicClient) {
        const response = await anthropicClient.messages.create({
          model: llmConfig.model,
          max_tokens: MAX_TOKENS,
          messages: [{ role: 'user', content: prompt }],
        });
        const text = response.content.find(b => b.type === 'text')?.text ?? '';
        return parseJson<ParsedQuery>(text);
      }

      const response = await openAiClient!.chat.completions.create({
        model: llmConfig.model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: MAX_TOKENS,
      });
      return parseJson<ParsedQuery>(response.choices[0]?.message.content ?? '');
    },
  };
}
