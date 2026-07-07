import { describe, it, expect, vi } from 'vitest';

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: JSON.stringify({
          description: 'Test email summary.',
          actionItems: ['Reply by Friday'],
          keyPoints: ['Budget approved'],
        })}],
      }),
    },
  })),
}));

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{ message: { content: JSON.stringify({
            description: 'Test summary.',
            actionItems: [],
            keyPoints: [],
          }) } }],
        }),
      },
    },
  })),
}));

import { createAiService } from './ai.js';
import type { LLMConfig } from '@gmail-sweep/shared';

describe('AI service', () => {
  describe('with Anthropic provider', () => {
    const llmConfig: LLMConfig = { provider: 'anthropic', model: 'claude-sonnet-4-6', apiKey: 'test-key' };

    it('passes baseUrl to the Anthropic client when configured', async () => {
      const Anthropic = (await import('@anthropic-ai/sdk')).default;
      const MockAnthropic = vi.mocked(Anthropic);
      MockAnthropic.mockClear();

      createAiService({ ...llmConfig, baseUrl: 'http://localhost:8080' });

      expect(MockAnthropic).toHaveBeenCalledWith(
        expect.objectContaining({ baseURL: 'http://localhost:8080' })
      );
    });

    it('requests a token budget large enough for reasoning models (parseSearchQuery)', async () => {
      // Reasoning models (served via Anthropic-compatible proxies) can spend
      // 100+ tokens on hidden thinking before emitting text. A small
      // max_tokens makes them return empty content — search then 500s.
      const Anthropic = (await import('@anthropic-ai/sdk')).default;
      const MockAnthropic = vi.mocked(Anthropic);
      MockAnthropic.mockClear();

      const ai = createAiService(llmConfig);
      await ai.parseSearchQuery('emails about budgets');

      const client = MockAnthropic.mock.results[0]!.value;
      const call = vi.mocked(client.messages.create).mock.calls[0]![0];
      expect(call.max_tokens).toBeGreaterThanOrEqual(4096);
    });

    it('requests a token budget large enough for reasoning models (summarizeEmail)', async () => {
      const Anthropic = (await import('@anthropic-ai/sdk')).default;
      const MockAnthropic = vi.mocked(Anthropic);
      MockAnthropic.mockClear();

      const ai = createAiService(llmConfig);
      await ai.summarizeEmail('Some email body');

      const client = MockAnthropic.mock.results[0]!.value;
      const call = vi.mocked(client.messages.create).mock.calls[0]![0];
      expect(call.max_tokens).toBeGreaterThanOrEqual(4096);
    });

    it('strips URLs from the email body before summarizing', async () => {
      // Marketing emails are walls of tracking URLs; they waste the model's
      // input budget and inflate hidden reasoning until output is truncated.
      const Anthropic = (await import('@anthropic-ai/sdk')).default;
      const MockAnthropic = vi.mocked(Anthropic);
      MockAnthropic.mockClear();

      const ai = createAiService(llmConfig);
      await ai.summarizeEmail('Buy now https://shop.example.com/x?utm_source=email today');

      const client = MockAnthropic.mock.results[0]!.value;
      const call = vi.mocked(client.messages.create).mock.calls[0]![0];
      const prompt = call.messages[0].content as string;
      expect(prompt).toContain('Buy now');
      expect(prompt).toContain('today');
      expect(prompt).not.toContain('https://');
    });

    it('generates a structured summary', async () => {
      const ai = createAiService(llmConfig);
      const summary = await ai.summarizeEmail('Test email body about budget approval');
      expect(summary.description).toBeTypeOf('string');
      expect(Array.isArray(summary.actionItems)).toBe(true);
      expect(Array.isArray(summary.keyPoints)).toBe(true);
    });
  });

  describe('parseSearchQuery', () => {
    const llmConfig: LLMConfig = { provider: 'openai', model: 'gpt-4o', apiKey: 'test-key' };

    it('parses a natural language query into filters and semantic query', async () => {
      const mockCreate = vi.fn().mockResolvedValue({
        choices: [{ message: { content: JSON.stringify({
          filters: { sender: 'sarah' },
          semanticQuery: 'project deadline',
        })}}],
      });

      vi.mocked((await import('openai')).default).mockImplementationOnce(() => ({
        chat: { completions: { create: mockCreate } },
      }) as any);

      const ai = createAiService(llmConfig);
      const parsed = await ai.parseSearchQuery('emails from sarah about project deadline');
      expect(parsed.filters.sender).toBe('sarah');
      expect(parsed.semanticQuery).toBe('project deadline');
    });
  });
});
