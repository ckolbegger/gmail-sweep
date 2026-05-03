import type { AiProviderMode, GmailProviderMode } from "@gmail-sweep/shared/src/provider";
import { loadConfig } from "../../packages/backend/src/config/load";
import { checkRealPrereqs, type PrereqCheckResult } from "./check-real-prereqs";
import { runTmux } from "./run-tmux";

export interface AcceptanceEvaluationInput {
  paneText: string;
  providerModes: {
    gmail: GmailProviderMode;
    ai: AiProviderMode;
  };
  prereqs: PrereqCheckResult;
}

export interface AcceptanceEvaluation {
  status: "PASS" | "BLOCKED";
  reasons: string[];
}

const probeResultPattern = /(Gmail probe: (PASS|BLOCKED).+AI probe: (PASS|BLOCKED)|Provider probes: BLOCKED)/s;

export function evaluateRealServiceAcceptance(input: AcceptanceEvaluationInput): AcceptanceEvaluation {
  const reasons: string[] = [];

  if (!probeResultPattern.test(input.paneText)) {
    reasons.push("TUI did not render provider probe PASS or BLOCKED results");
  }

  if (input.providerModes.gmail === "fakeGmail" || input.providerModes.ai === "fakeAI") {
    reasons.push("Real-service acceptance requires non-fake Gmail and AI providers");
  }

  if (input.prereqs.status === "BLOCKED") {
    reasons.push(...input.prereqs.reasons);
  }

  return {
    status: reasons.length === 0 ? "PASS" : "BLOCKED",
    reasons,
  };
}

async function main(): Promise<void> {
  const config = loadConfig();
  const sessionName = `gmail-sweep-a1-${process.pid}`;

  const tmux = await runTmux({
    sessionName,
    command: "bun run packages/tui/src/index.tsx",
    readyText: /Keys: p probe providers, q quit/,
    keys: [{ keys: "p" }],
    cleanupKeys: [{ keys: "q" }],
    expectText: probeResultPattern,
    timeoutMs: 15_000,
  });

  const prereqs = await checkRealPrereqs({ config });
  const evaluation = evaluateRealServiceAcceptance({
    paneText: tmux.paneText,
    providerModes: {
      gmail: config.gmail.provider,
      ai: config.ai.provider,
    },
    prereqs,
  });

  printResult(evaluation, tmux.paneText);
  process.exitCode = 0;
}

function printResult(evaluation: AcceptanceEvaluation, paneText: string): void {
  if (evaluation.status === "PASS") {
    console.log("PASS");
    console.log("TUI booted, accepted p, and rendered real provider probe results.");
    return;
  }

  console.log("BLOCKED");
  for (const reason of evaluation.reasons) {
    console.log(`- ${reason}`);
  }
  console.log("\nCaptured TUI:");
  console.log(paneText.trim());
}

if (import.meta.main) {
  await main();
}
