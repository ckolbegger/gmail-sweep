import type Database from "bun:sqlite";
import type { EmbedProvider } from "./embed-provider";
import type { ExtractionStrategy } from "../../shared/types";
import { buildEmbeddingText } from "./extraction-strategies";

export class EmbeddingWorker {
  private running = false;
  private intervalTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private db: Database,
    private provider: EmbedProvider,
    private strategy: ExtractionStrategy,
    private dimension: number,
    private batch: number = 16
  ) {}

  getStatus(): { totalEmails: number; unembedded: number } {
    const total = (this.db.query("SELECT COUNT(*) as c FROM emails").get() as any).c;
    const unembedded = (this.db.query(
      `SELECT COUNT(*) as c FROM emails e
       LEFT JOIN vec_embeddings v ON v.email_id = e.id
       WHERE v.email_id IS NULL`
    ).get() as any).c;
    return { totalEmails: total, unembedded };
  }

  start(intervalMs: number = 60000): void {
    if (this.running) return;
    this.running = true;
    console.log(`EmbeddingWorker starting with interval ${intervalMs}ms, queue depth: ${this.getStatus().unembedded}`);
    this.intervalTimer = setInterval(() => {
      this.processPending().catch((err) => {
        console.error("[EmbeddingWorker] Error in auto-run:", err);
      });
    }, intervalMs);
    this.processPending().catch((err) => {
      console.error("[EmbeddingWorker] Error in initial run:", err);
    });
  }

  stop(): void {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
    this.running = false;
  }

  async processPending(): Promise<{ processed: number; failed: number }> {
    // Emails that have content but lack a vec_embeddings row
    const rows = this.db
      .query(
        `SELECT e.id, e.subject, e.body_text FROM emails e
         LEFT JOIN vec_embeddings v ON v.email_id = e.id
         WHERE v.email_id IS NULL
         ORDER BY e.date_received DESC
         LIMIT ?`
      )
      .all(this.batch * 10) as Array<{ id: string; subject: string; body_text: string | null }>;

    let processed = 0;
    let failed = 0;

    for (let i = 0; i < rows.length; i += this.batch) {
      const slice = rows.slice(i, i + this.batch);
      const results = await Promise.allSettled(slice.map((r) => this.one(r)));
      for (const r of results) r.status === "fulfilled" ? processed++ : failed++;
    }
    return { processed, failed };
  }

  private async one(row: { id: string; subject: string; body_text: string | null }): Promise<void> {
    const text = buildEmbeddingText({ subject: row.subject ?? "", bodyText: row.body_text ?? "" }, this.strategy);
    const vec = await this.provider.embedDocument(text);
    if (vec.length !== this.dimension) {
      throw new Error(`embedding dimension ${vec.length} != configured ${this.dimension}`);
    }
    const buf = Buffer.from(new Float32Array(vec).buffer);
    // vec0 has no ON CONFLICT; delete-then-insert in a transaction.
    const tx = this.db.transaction((id: string, b: Buffer) => {
      this.db.run("DELETE FROM vec_embeddings WHERE email_id = ?", [id]);
      this.db.run("INSERT INTO vec_embeddings(email_id, embedding) VALUES (?, ?)", [id, b]);
    });
    tx(row.id, buf);
  }
}
