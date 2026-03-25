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
  };
}

export async function loadConfig(): Promise<AppConfig> {
  const configPath = getConfigPath();

  let config: AppConfig;
  try {
    const raw = await fs.readFile(configPath, 'utf-8');
    config = JSON.parse(raw) as AppConfig;
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
