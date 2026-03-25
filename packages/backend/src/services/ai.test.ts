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
