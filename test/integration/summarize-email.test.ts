import { describe, it, expect } from "bun:test";
import { loadConfig } from "../../src/backend/config";
import { initDb } from "../../src/backend/db";
import { createLlmProvider } from "../../src/backend/llm/create-provider";

const EMAIL_ID = "19d401e410b6f5b6";

describe("integration: summarize a real email via LLM", () => {
  it(
    "summarizes email and returns structured result",
    async () => {
      const config = loadConfig("config.toml");
      const db = initDb("gmail-sweep.db");

      const email = db
        .query("SELECT sender, subject, body_text FROM emails WHERE id = ?")
        .get(EMAIL_ID) as {
        sender: string;
        subject: string;
        body_text: string;
      } | null;

      expect(email).not.toBeNull();
      expect(email!.body_text.length).toBeGreaterThan(1000);

      const provider = createLlmProvider(config.llm);
      const result = await provider.summarize({
        sender: email!.sender,
        subject: email!.subject,
        body: email!.body_text,
      });

      console.log("--- LLM Summary Result ---");
      console.log("Subject:", email!.subject);
      console.log("Sender:", email!.sender);
      console.log("Body length:", email!.body_text.length, "chars");
      console.log("Summary:", result.summary);
      console.log("Action Items:", result.actionItems);
      console.log("Key Points:", result.keyPoints);
      console.log("Model:", result.model);

      expect(result.summary).toBeTruthy();
      expect(typeof result.summary).toBe("string");
      expect(result.summary.length).toBeGreaterThan(10);
      expect(Array.isArray(result.actionItems)).toBe(true);
      expect(Array.isArray(result.keyPoints)).toBe(true);
      expect(result.model).toBeTruthy();
    },
    { timeout: 30_000 }
  );
});
