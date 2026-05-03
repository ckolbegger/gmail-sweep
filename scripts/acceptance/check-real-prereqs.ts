import type { AppConfig } from "@gmail-sweep/shared/src/config";
import { loadConfig } from "../../packages/backend/src/config/load";
import {
  createGoogleGmailProbe,
  readGoogleCredentials,
  readStoredGoogleTokens,
  type GoogleGmailProbe,
} from "../../packages/backend/src/providers/gmail/google";

type Env = Record<string, string | undefined>;

export interface PrereqGmailProbe {
  getProfile(): Promise<{ email: string }>;
  findLabel(name: string): Promise<{ id: string; name: string } | null>;
  listMessagesForLabel(labelId: string, maxResults: number): Promise<{ id: string }[]>;
}

export interface PrereqCheckOptions {
  env?: Env;
  config?: AppConfig;
  gmail?: PrereqGmailProbe;
}

export interface PrereqCheckResult {
  status: "PASS" | "BLOCKED";
  reasons: string[];
}

const testLabelName = "gmail-sweep-test";

export async function checkRealPrereqs(options: PrereqCheckOptions = {}): Promise<PrereqCheckResult> {
  const env = options.env ?? process.env;
  const config = options.config ?? loadConfig(env);
  const reasons: string[] = [];
  const credentials = readGoogleCredentials(env);

  if (!env.GOOGLE_CLIENT_ID) {
    reasons.push("Missing GOOGLE_CLIENT_ID");
  }

  if (!env.GOOGLE_CLIENT_SECRET) {
    reasons.push("Missing GOOGLE_CLIENT_SECRET");
  }

  const aiKeyEnv = getAiKeyEnv(config);
  if (aiKeyEnv && !env[aiKeyEnv]) {
    reasons.push(`Missing ${aiKeyEnv}`);
  }

  if (!config.activeAccountId) {
    reasons.push("Missing active account");
  }

  if (!options.gmail && config.activeAccountId && !readStoredGoogleTokens(env, config.activeAccountId)) {
    reasons.push("Active account is not authenticated with Google");
  }

  if (reasons.length > 0) {
    return { status: "BLOCKED", reasons };
  }

  const gmail = options.gmail ?? createProbe(credentials, env, config.activeAccountId);

  try {
    await gmail.getProfile();
    const label = await gmail.findLabel(testLabelName);

    if (!label) {
      reasons.push(`Missing Gmail label ${testLabelName}`);
      return { status: "BLOCKED", reasons };
    }

    const messages = await gmail.listMessagesForLabel(label.id, 1);

    if (messages.length === 0) {
      reasons.push(`No read-only acceptance messages found in ${testLabelName}`);
    }
  } catch (error) {
    reasons.push(error instanceof Error ? error.message : "Real Gmail prereq check failed");
  }

  return {
    status: reasons.length > 0 ? "BLOCKED" : "PASS",
    reasons,
  };
}

function getAiKeyEnv(config: AppConfig): string | null {
  if (config.ai.provider === "fakeAI") {
    return null;
  }

  if (config.ai.apiKeyEnv) {
    return config.ai.apiKeyEnv;
  }

  if (config.ai.provider === "openai") {
    return "OPENAI_API_KEY";
  }

  return "ANTHROPIC_API_KEY";
}

function createProbe(
  credentials: ReturnType<typeof readGoogleCredentials>,
  env: Env,
  accountId: string | null,
): GoogleGmailProbe {
  if (!credentials || !accountId) {
    throw new Error("Cannot create Google Gmail probe without credentials and active account");
  }

  return createGoogleGmailProbe(env, accountId);
}

if (import.meta.main) {
  const dryRun = process.argv.includes("--dry-run");
  const result = await checkRealPrereqs();
  const lines = result.reasons.length > 0 ? result.reasons.map((reason) => `- ${reason}`).join("\n") : "All prereqs met";

  console.log(`${result.status}\n${lines}`);
  process.exitCode = dryRun || result.status === "PASS" ? 0 : 1;
}
