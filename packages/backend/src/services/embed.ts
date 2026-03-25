import OpenAI from 'openai';
import type { EmbeddingConfig } from '@gmail-sweep/shared';

export interface EmbedService {
  embedDocument(text: string): Promise<number[]>;
  embedQuery(text: string): Promise<number[]>;
}

// --- Local provider (Transformers.js) ---

type Extractor = (...args: unknown[]) => Promise<{ data: Float32Array }>;

async function loadExtractor(model: string): Promise<Extractor> {
  console.log(`Loading local embedding model: ${model} (first run downloads model files, then cached)`);
  const { pipeline } = await import('@huggingface/transformers');
  return (await pipeline('feature-extraction', model)) as unknown as Extractor;
}

// --- OpenAI-compatible provider ---

async function embedApi(config: EmbeddingConfig, text: string): Promise<number[]> {
  const client = new OpenAI({ apiKey: config.apiKey ?? 'local', baseURL: config.baseUrl });
  const response = await client.embeddings.create({ model: config.model, input: text });
  return response.data[0]!.embedding;
}

// --- Factory ---

export function createEmbedService(config: EmbeddingConfig): EmbedService {
  if (config.provider === 'local') {
    // Lazy-load the extractor once per service instance.
    // BGE-M3 uses symmetric embedding — no query prefix needed.
    let extractorPromise: Promise<Extractor> | null = null;
    const getExtractor = () => {
      if (!extractorPromise) extractorPromise = loadExtractor(config.model);
      return extractorPromise;
    };
    const embed = async (text: string): Promise<number[]> => {
      const extractor = await getExtractor();
      const output = await extractor(text, { pooling: 'mean', normalize: true });
      return Array.from(output.data);
    };
    return { embedDocument: embed, embedQuery: embed };
  }
  // openai-compatible: no query prefix — the serving endpoint handles model-specific behaviour
  return {
    embedDocument: (text) => embedApi(config, text),
    embedQuery: (text) => embedApi(config, text),
  };
}
