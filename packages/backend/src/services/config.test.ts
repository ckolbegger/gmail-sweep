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

  it('saves and reloads config', async () => {
    const config = await loadConfig();
    config.sync.defaultBatchSize = 100;
    await saveConfig(config);

    const reloaded = await loadConfig();
    expect(reloaded.sync.defaultBatchSize).toBe(100);
  });
});
