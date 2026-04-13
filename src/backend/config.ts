import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import TOML, { stringify as tomlStringify } from "smol-toml";

export interface EmbeddingSectionCfg {
  provider: "local" | "openai-compatible";
  model: string;
  dimension: number;
  api_key?: string;
  base_url?: string;
}

export interface ExtractionStrategyCfg {
  type: "template";
  template: string;
}

export interface ContentExtractionCfg {
  active_strategy: string;
  strategies: Record<string, ExtractionStrategyCfg>;
}

export interface Config {
  server: {
    host: string;
    port: number;
  };
  auth: {
    credentials_path: string;
    token_path: string;
  };
  sync: {
    batch_size: number;
    poll_interval_seconds: number;
  };
  llm: {
    provider: string;
    api_key: string;
    model: string;
    base_url: string;
  };
  embedding: EmbeddingSectionCfg;
  content_extraction: ContentExtractionCfg;
}

function expandPath(p: string): string {
  if (p.startsWith("~")) {
    return join(homedir(), p.slice(1));
  }
  return p;
}

export function loadConfig(configPath: string): Config {
  if (!existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }

  const raw = readFileSync(configPath, "utf-8");
  const data = TOML.parse(raw) as Record<string, Record<string, unknown>>;

  const server = data.server ?? {};
  const auth = data.auth ?? {};
  const sync = data.sync ?? {};
  const llm = data.llm ?? {};
  const embedding = data.embedding ?? {};
  const content_extraction = data.content_extraction ?? {};

  // Required fields
  if (!auth.credentials_path) {
    throw new Error("Missing required config: auth.credentials_path");
  }
  if (!auth.token_path) {
    throw new Error("Missing required config: auth.token_path");
  }

  const port = Number(server.port ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("server.port must be an integer between 1 and 65535");
  }

  const batchSize = Number(sync.batch_size ?? 100);
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new Error("sync.batch_size must be a positive integer");
  }

  return {
    server: {
      host: String(server.host ?? "127.0.0.1"),
      port,
    },
    auth: {
      credentials_path: expandPath(String(auth.credentials_path)),
      token_path: expandPath(String(auth.token_path)),
    },
    sync: {
      batch_size: batchSize,
      poll_interval_seconds: Number(sync.poll_interval_seconds ?? 300),
    },
    llm: {
      provider: String(llm.provider ?? "openai"),
      api_key: String(llm.api_key ?? ""),
      model: String(llm.model ?? "gpt-4o-mini"),
      base_url: String(llm.base_url ?? "https://api.openai.com/v1"),
    },
    embedding: {
      provider: (embedding.provider as EmbeddingSectionCfg["provider"]) ?? "local",
      model: String(embedding.model ?? "BAAI/bge-m3"),
      dimension: Number(embedding.dimension ?? 1024),
      ...(embedding.api_key ? { api_key: String(embedding.api_key) } : {}),
      ...(embedding.base_url ? { base_url: String(embedding.base_url) } : {}),
    },
    content_extraction: {
      active_strategy: String(content_extraction.active_strategy ?? "default"),
      strategies: (content_extraction.strategies ?? {
        default: {
          type: "template" as const,
          template: "Subject: {{subject}}\n\n{{body_text}}",
        },
      }) as Record<string, ExtractionStrategyCfg>,
    },
  };
}

export function saveConfig(path: string, cfg: Config): void {
  writeFileSync(path, tomlStringify(cfg as any));
}
