import type Database from "bun:sqlite";
import type { EmbeddingProvider } from "@backend/llm/provider";

export class EmbeddingWorker {
  private db: Database;
  private embeddingProvider: EmbeddingProvider;
  private concurrency: number;

  constructor(db: Database, embeddingProvider: EmbeddingProvider, concurrency: number = 5) {
    this.db = db;
    this.embeddingProvider = embeddingProvider;
    this.concurrency = concurrency;
  }

  async processPending(): Promise<{ processed: number; failed: number }> {
    const rows = this.db
      .query(
        "SELECT id, subject, summary FROM emails WHERE embedding IS NULL AND ai_status = 'done'"
      )
      .all() as any[];

    let processed = 0;
    let failed = 0;

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

  private async processOne(row: { id: string; subject: string; summary: string }): Promise<void> {
    const text = `${row.subject} ${row.summary}`;
    const embedding = await this.embeddingProvider.embed(text);

    // Store as Float32Array BLOB
    const float32 = new Float32Array(embedding);
    const blob = Buffer.from(float32.buffer);

    this.db.run(
      `UPDATE emails SET embedding = ?, embedding_model = ?, embedding_generated_at = ? WHERE id = ?`,
      [blob, "mock", Date.now(), row.id]
    );
  }
}
