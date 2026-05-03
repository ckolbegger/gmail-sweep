export interface BackendHandle {
  startedBySupervisor: boolean;
  baseUrl: string;
  stop(): void;
}

export interface StartedProcess {
  kill(signal?: number | NodeJS.Signals): unknown;
}

export interface EnsureBackendOptions {
  host?: string;
  port?: number;
  statusUrl?: string;
  fetch?: typeof fetch;
  startProcess?: () => StartedProcess;
  retryDelayMs?: number;
  maxAttempts?: number;
}

interface StatusBody {
  ok?: boolean;
}

export async function ensureBackend(options: EnsureBackendOptions = {}): Promise<BackendHandle> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 3000;
  const baseUrl = `http://${host}:${port}`;
  const statusUrl = options.statusUrl ?? `${baseUrl}/status`;
  const fetchStatus = options.fetch ?? fetch;

  if (await isCompatibleBackend(statusUrl, fetchStatus)) {
    return {
      startedBySupervisor: false,
      baseUrl,
      stop() {},
    };
  }

  const process = (options.startProcess ?? defaultStartProcess)();
  const maxAttempts = options.maxAttempts ?? 50;
  const retryDelayMs = options.retryDelayMs ?? 100;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (await isCompatibleBackend(statusUrl, fetchStatus)) {
      return {
        startedBySupervisor: true,
        baseUrl,
        stop() {
          process.kill();
        },
      };
    }

    await sleep(retryDelayMs);
  }

  process.kill();
  throw new Error(`Backend did not become ready at ${statusUrl}`);
}

async function isCompatibleBackend(statusUrl: string, fetchStatus: typeof fetch): Promise<boolean> {
  try {
    const response = await fetchStatus(statusUrl);
    if (!response.ok) {
      return false;
    }

    const body = (await response.json()) as StatusBody;
    return body.ok === true;
  } catch {
    return false;
  }
}

function defaultStartProcess(): StartedProcess {
  return Bun.spawn(["bun", "run", "packages/backend/src/index.ts"], {
    cwd: process.cwd(),
    stdout: "ignore",
    stderr: "inherit",
  });
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => setTimeout(resolve, ms));
}
