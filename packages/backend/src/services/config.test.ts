import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// We'll mock homedir to point at a temp directory
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof os>();
  return { ...actual, homedir: vi.fn() };
});

import { loadConfig, saveConfig, getDefaultConfig } from '../config.js';
import type { AppConfig } from '@gmail-sweep/shared';

describe('config', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gmail-sweep-test-'));
    vi.mocked(os.homedir).mockReturnValue(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true });
  });

  it('returns defaults when config file does not exist', async () => {
    const config = await loadConfig();
    expect(config.sync.defaultBatchSize).toBe(500);
    expect(config.contentExtraction.activeStrategy).toBe('v1-plain');
  });

  it('creates config directory and file on first load', async () => {
    await loadConfig();
    const configPath = path.join(tmpDir, '.gmail-sweep', 'config.json');
    const exists = await fs.access(configPath).then(() => true).catch(() => false);
    expect(exists).toBe(true);
  });

  it('fills in defaults for sections missing from the config file (foreign schema)', async () => {
    // Simulate a config.json written by a different implementation: valid JSON,
    // but none of this app's required sections are present.
    const configDir = path.join(tmpDir, '.gmail-sweep');
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(
      path.join(configDir, 'config.json'),
      JSON.stringify({
        activeAccountId: 'gmail-primary',
        ai: { provider: 'anthropic', apiKeyEnv: 'ANTHROPIC_API_KEY' },
        backend: { host: '127.0.0.1', port: 3000 },
        sync: { maxMessagesPerFetch: 100 },
      }),
      'utf-8'
    );

    const config = await loadConfig();
    expect(config.google).toBeDefined();
    expect(config.embedding).toBeDefined();
    expect(config.embedding.provider).toBe('local');
    expect(config.embedding.dimension).toBe(1024);
    expect(config.llm.provider).toBe('anthropic');
    expect(config.sync.defaultBatchSize).toBe(500);
    expect(config.contentExtraction.activeStrategy).toBe('v1-plain');
    expect(config.contentExtraction.strategies['v1-plain']).toBeDefined();
  });

  it('preserves user values while filling in missing sibling keys', async () => {
    const configDir = path.join(tmpDir, '.gmail-sweep');
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(
      path.join(configDir, 'config.json'),
      JSON.stringify({
        embedding: { provider: 'local', model: 'custom-model' },
        sync: { defaultBatchSize: 42 },
      }),
      'utf-8'
    );

    const config = await loadConfig();
    expect(config.embedding.model).toBe('custom-model');
    expect(config.embedding.dimension).toBe(1024); // filled from defaults
    expect(config.sync.defaultBatchSize).toBe(42);
    expect(config.google.redirectUri).toBe('http://localhost:3141/auth/callback');
  });

  it('saves and reloads config', async () => {
    const config = await loadConfig();
    config.sync.defaultBatchSize = 100;
    await saveConfig(config);

    const reloaded = await loadConfig();
    expect(reloaded.sync.defaultBatchSize).toBe(100);
  });
});
