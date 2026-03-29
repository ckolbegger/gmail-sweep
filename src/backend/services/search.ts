import type Database from "bun:sqlite";
import { parseQuery, buildSqlFilters } from "./search-parser";

export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
}

export interface SearchResult {
  id: string;
  thread_id: string;
  sender: string;
  recipients: string;
  subject: string;
  date_received: number;
  is_read: boolean;
  is_starred: boolean;
  summary: string | null;
  score: number | null;
}

export class SearchService {
  constructor(
    private db: Database,
    private embeddingProvider?: EmbeddingProvider
  ) {}

  async search(query: string, limit: number = 50): Promise<SearchResult[]> {
    const parsed = parseQuery(query);
    const { where, params } = buildSqlFilters(parsed);

    // If no free text, or no embedding provider -> pure SQL search
    if (!parsed.freeText.trim() || !this.embeddingProvider) {
      return this.sqlSearch(where, params, limit);
    }

    // Vector search with filters
    return this.vectorSearch(parsed.freeText, where, params, limit);
  }

  private sqlSearch(
    where: string,
    params: any[],
    limit: number
  ): SearchResult[] {
    const sql = `SELECT id, thread_id, sender, recipients, subject, date_received, is_read, is_starred, summary
       FROM emails ${where ? "WHERE " + where : ""}
       ORDER BY date_received DESC
       LIMIT ?`;

    const rows = this.db.query(sql).all(...params, limit) as any[];

    return rows.map((r: any) => ({
      id: r.id,
      thread_id: r.thread_id,
      sender: r.sender,
      recipients: r.recipients,
      subject: r.subject,
      date_received: r.date_received,
      is_read: r.is_read === 1,
      is_starred: r.is_starred === 1,
      summary: r.summary,
      score: null,
    }));
  }

  private async vectorSearch(
    freeText: string,
    where: string,
    params: any[],
    limit: number
  ): Promise<SearchResult[]> {
    const embedding = await this.embeddingProvider!.embed(freeText);

    const whereClause = where
      ? `WHERE ${where} AND embedding IS NOT NULL`
      : "WHERE embedding IS NOT NULL";

    const candidates = this.db
      .query(
        `SELECT id, thread_id, sender, recipients, subject, date_received, is_read, is_starred, summary, embedding
         FROM emails
         ${whereClause}
         ORDER BY date_received DESC
         LIMIT 500`
      )
      .all(...params) as any[];

    // Compute cosine similarity in JS
    const scored = candidates.map((row: any) => {
      const raw = row.embedding as Uint8Array;
      const rowEmbedding = Array.from(new Float64Array(raw.buffer, raw.byteOffset, raw.byteLength / 8));
      const score = cosineSimilarity(embedding, rowEmbedding);
      return { ...row, score };
    });

    scored.sort((a: any, b: any) => b.score - a.score);

    return scored.slice(0, limit).map((r: any) => ({
      id: r.id,
      thread_id: r.thread_id,
      sender: r.sender,
      recipients: r.recipients,
      subject: r.subject,
      date_received: r.date_received,
      is_read: r.is_read === 1,
      is_starred: r.is_starred === 1,
      summary: r.summary,
      score: r.score,
    }));
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0,
    normA = 0,
    normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dot / denominator;
}
