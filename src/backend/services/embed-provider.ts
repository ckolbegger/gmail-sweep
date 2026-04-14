import OpenAI from "openai";
import type { EmbeddingConfig } from "../../shared/types";

export interface EmbedProvider {
  embedDocument(text: string): Promise<number[]>;
  embedQuery(text: string): Promise<number[]>;
}

type Extractor = (text: string, opts: { pooling: "mean"; normalize: true }) => Promise<{ data: Float32Array }>;

function loadLocal(model: string): Promise<Extractor> {
  return import("@huggingface/transformers").then(async ({ pipeline }) => {
    return (await pipeline("feature-extraction", model)) as unknown as Extractor;
  });
}

function openAiCompat(cfg: EmbeddingConfig): EmbedProvider {
  const client = new OpenAI({
    apiKey: cfg.api_key ?? "local",
    baseURL: cfg.base_url,
  });
  const embed = async (text: string): Promise<number[]> => {
    const r = await client.embeddings.create({ model: cfg.model, input: text });
    return r.data[0]!.embedding as number[];
  };
  return { embedDocument: embed, embedQuery: embed };
}

function localProvider(cfg: EmbeddingConfig): EmbedProvider {
  let p: Promise<Extractor> | null = null;
  const get = () => (p ??= loadLocal(cfg.model));
  const embed = async (text: string): Promise<number[]> => {
    const ex = await get();
    const out = await ex(text, { pooling: "mean", normalize: true });
    return Array.from(out.data);
  };
  return { embedDocument: embed, embedQuery: embed };
}

export function createEmbedProvider(cfg: EmbeddingConfig): EmbedProvider {
  if (cfg.provider === "openai-compatible") return openAiCompat(cfg);
  if (cfg.provider === "local") return localProvider(cfg);
  throw new Error(`unknown embedding provider: ${(cfg as any).provider}`);
}
