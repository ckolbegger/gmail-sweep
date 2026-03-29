import type Database from "bun:sqlite";
import type { LLMProvider } from "@backend/llm/provider";

export class SummaryWorker {
  private db: Database;
  private llmProvider: LLMProvider;
  private concurrency: number;
  private intervalTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(db: Database, llmProvider: LLMProvider, concurrency: number = 3) {
    this.db = db;
    this.llmProvider = llmProvider;
    this.concurrency = concurrency;
  }

  async processPending(): Promise<{ processed: number; failed: number }> {
    const rows = this.db
      .query(
        "SELECT id, sender, subject, body_text FROM emails WHERE ai_status = 'pending' ORDER BY date_received DESC"
      )
      .all() as any[];

    let processed = 0;
    let failed = 0;

    // Process in batches up to concurrency
    for (let i = 0; i < rows.length; i += this.concurrency) {
      const batch = rows.slice(i, i + this.concurrency);
      const results = await Promise.allSettled(
        batch.map((row) => this.processOne(row))
      );
      for (const result of results) {
        if (result.status === "fulfilled") {
          processed++;
        } else {
          failed++;
        }
      }
    }

    return { processed, failed };
  }

  private async processOne(row: { id: string; sender: string; subject: string; body_text: string }): Promise<void> {
    // Set processing
    this.db.run("UPDATE emails SET ai_status = 'processing' WHERE id = ?", [row.id]);

    try {
      const result = await this.llmProvider.summarize({
        sender: row.sender,
        subject: row.subject,
        body: row.body_text,
      });

      this.db.run(
        `UPDATE emails SET
          ai_status = 'done',
          summary = ?,
          action_items = ?,
          key_points = ?,
          summary_model = ?,
          summary_generated_at = ?
        WHERE id = ?`,
        [
          result.summary,
          JSON.stringify(result.actionItems),
          JSON.stringify(result.keyPoints),
          result.model,
          Date.now(),
          row.id,
        ]
      );
    } catch (err) {
      this.db.run("UPDATE emails SET ai_status = 'failed' WHERE id = ?", [row.id]);
      throw err;
    }
  }

  getQueueDepth(): number {
    const row = this.db
      .query("SELECT COUNT(*) as c FROM emails WHERE ai_status = 'pending'")
      .get() as any;
    return row?.c ?? 0;
  }

  start(intervalMs: number = 30000): void {
    if (this.running) return;
    this.running = true;
    this.intervalTimer = setInterval(() => {
      this.processPending();
    }, intervalMs);
    // Process immediately on start
    this.processPending();
  }

  async shutdown(): Promise<void> {
    this.running = false;
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
  }
}
