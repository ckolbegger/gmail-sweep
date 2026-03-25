import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@huggingface/transformers', () => ({
  pipeline: vi.fn().mockResolvedValue(
    vi.fn().mockResolvedValue({ data: new Float32Array(1024).fill(0.1) })
  ),
}));

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    embeddings: {
      create: vi.fn().mockResolvedValue({
        data: [{ embedding: new Array(768).fill(0.1) }],
      }),
    },
  })),
}));

import { createEmbedService } from './embed.js';
import type { EmbeddingConfig } from '@gmail-sweep/shared';

describe('embed service', () => {
  describe('local provider', () => {
    const config: EmbeddingConfig = {
      provider: 'local',
      model: 'Xenova/bge-m3',
      dimension: 1024,
    };

    it('embedDocument returns a 1024-element float array', async () => {
      const svc = createEmbedService(config);
      const vec = await svc.embedDocument('Subject: Hello\n\nTest body');
      expect(Array.isArray(vec)).toBe(true);
      expect(vec).toHaveLength(1024);
    });

    it('embedQuery returns a 1024-element float array', async () => {
      const svc = createEmbedService(config);
      const vec = await svc.embedQuery('emails about project deadlines');
      expect(Array.isArray(vec)).toBe(true);
      expect(vec).toHaveLength(1024);
    });

    it('embedQuery passes text directly without any prefix', async () => {
      const { pipeline } = await import('@huggingface/transformers');
      const mockExtractor = vi.fn().mockResolvedValue({ data: new Float32Array(1024).fill(0.1) });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(pipeline as any).mockResolvedValueOnce(mockExtractor);

      const svc = createEmbedService(config);
      await svc.embedQuery('project deadline');

      const callArg = (mockExtractor.mock.calls[0] as [string])[0];
      expect(callArg).toBe('project deadline');
    });
  });

  describe('openai-compatible provider', () => {
    const config: EmbeddingConfig = {
      provider: 'openai-compatible',
      model: 'nomic-embed-text-v1.5',
      dimension: 768,
      baseUrl: 'http://localhost:1234/v1',
    };

    it('embedDocument calls the configured API endpoint and returns the right dimension', async () => {
      const svc = createEmbedService(config);
      const vec = await svc.embedDocument('test text');
      expect(vec).toHaveLength(768);
    });

    it('embedQuery does not prepend any prefix', async () => {
      const OpenAI = (await import('openai')).default;
      const mockCreate = vi.fn().mockResolvedValue({
        data: [{ embedding: new Array(768).fill(0.1) }],
      });
      vi.mocked(OpenAI).mockImplementationOnce(() => ({
        embeddings: { create: mockCreate },
      }) as any);

      const svc = createEmbedService(config);
      await svc.embedQuery('project deadline');

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ input: 'project deadline' })
      );
    });
  });
});
