import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { AppConfig } from '@gmail-sweep/shared';

function getConfigDir(): string {
  return path.join(os.homedir(), '.gmail-sweep');
}

function getConfigPath(): string {
  return path.join(getConfigDir(), 'config.json');
}

export function getDefaultConfig(): AppConfig {
  return {
    google: {
      clientId: '',
      clientSecret: '',
      redirectUri: 'http://localhost:3141/auth/callback',
    },
    llm: {
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
    },
    embedding: {
      provider: 'local',
      model: 'Xenova/bge-m3',
      dimension: 1024,
    },
    sync: {
      defaultBatchSize: 500,
    },
    contentExtraction: {
      activeStrategy: 'v1-plain',
      strategies: {
        'v1-plain': {
          type: 'template',
          template: 'Subject: {{subject}}\n\n{{body_text}}',
        },
      },
    },
    terminal: {
      summarizerPollIntervalMs: 30_000,
    },
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mergeDefaults<T>(defaults: T, loaded: unknown): T {
  if (!isPlainObject(defaults) || !isPlainObject(loaded)) {
    return (loaded === undefined ? defaults : loaded) as T;
  }
  const result: Record<string, unknown> = { ...loaded };
  for (const [key, defaultValue] of Object.entries(defaults)) {
    result[key] = mergeDefaults(defaultValue, loaded[key]);
  }
  return result as T;
}

export async function loadConfig(): Promise<AppConfig> {
  const configPath = getConfigPath();

  let config: AppConfig;
  try {
    const raw = await fs.readFile(configPath, 'utf-8');
    // The file may be partial or written by another tool — fill in any
    // missing sections from defaults so required config is always present.
    config = mergeDefaults(getDefaultConfig(), JSON.parse(raw));
  } catch {
    // File doesn't exist — create with defaults
    config = getDefaultConfig();
    await saveConfig(config);
  }

  if (process.env.GOOGLE_CLIENT_ID) config.google.clientId = process.env.GOOGLE_CLIENT_ID;
  if (process.env.GOOGLE_CLIENT_SECRET) config.google.clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  return config;
}

export async function saveConfig(config: AppConfig): Promise<void> {
  const configDir = getConfigDir();
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(getConfigPath(), JSON.stringify(config, null, 2), 'utf-8');
}
