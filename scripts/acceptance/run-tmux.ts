export interface TmuxKeyStep {
  keys: string;
  delayMs?: number;
}

export interface RunTmuxOptions {
  sessionName: string;
  command: string;
  keys?: TmuxKeyStep[];
  cleanupKeys?: TmuxKeyStep[];
  readyText?: RegExp;
  expectText?: RegExp;
  timeoutMs?: number;
}

export interface RunTmuxResult {
  paneText: string;
}

export async function runTmux(options: RunTmuxOptions): Promise<RunTmuxResult> {
  const timeoutMs = options.timeoutMs ?? 10_000;

  await run(["tmux", "kill-session", "-t", options.sessionName], { allowFailure: true });

  try {
    await run(["tmux", "new-session", "-d", "-s", options.sessionName, options.command]);

    if (options.readyText) {
      await waitForPaneText(options.sessionName, options.readyText, timeoutMs);
    }

    for (const step of options.keys ?? []) {
      if (step.delayMs) {
        await sleep(step.delayMs);
      }
      await run(["tmux", "send-keys", "-t", options.sessionName, step.keys]);
    }

    const paneText = await waitForPaneText(options.sessionName, options.expectText, timeoutMs);
    return { paneText };
  } finally {
    for (const step of options.cleanupKeys ?? []) {
      if (step.delayMs) {
        await sleep(step.delayMs);
      }
      await run(["tmux", "send-keys", "-t", options.sessionName, step.keys], { allowFailure: true });
    }
    await run(["tmux", "kill-session", "-t", options.sessionName], { allowFailure: true });
  }
}

async function waitForPaneText(
  sessionName: string,
  expectText: RegExp | undefined,
  timeoutMs: number,
): Promise<string> {
  const startedAt = Date.now();
  let paneText = "";

  do {
    paneText = await capturePane(sessionName);
    if (!expectText || expectText.test(paneText)) {
      return paneText;
    }

    await sleep(100);
  } while (Date.now() - startedAt < timeoutMs);

  throw new Error(`Timed out waiting for ${expectText?.source ?? "tmux output"}\n${paneText}`);
}

async function capturePane(sessionName: string): Promise<string> {
  const output = await run(["tmux", "capture-pane", "-p", "-t", sessionName]);
  return output.stdout;
}

async function run(
  command: string[],
  options: { allowFailure?: boolean } = {},
): Promise<{ stdout: string; stderr: string }> {
  const process = Bun.spawn(command, {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);

  if (exitCode !== 0 && !options.allowFailure) {
    throw new Error(`${command.join(" ")} failed with ${exitCode}: ${stderr || stdout}`);
  }

  return { stdout, stderr };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
