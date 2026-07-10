import type Database from "bun:sqlite";
import { parseQuery, buildSqlFilters } from "./search-parser";
import type { EmbedProvider } from "./embed-provider";
import type { LLMProvider, ParsedQuery } from "../llm/provider";

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
    private embeddingProvider?: EmbedProvider,
    private llmProvider?: LLMProvider,
    private llmTimeoutMs: number = 10000
  ) {}

  async search(query: string, limit: number = 50): Promise<SearchResult[]> {
    const parsed = parseQuery(query);
    const { where, params } = buildSqlFilters(parsed);

    const hasOperatorFilters = Object.keys(parsed.operators).length > 0;

    // If operators are present, always use operator-based search (no LLM fallback)
    if (hasOperatorFilters) {
      if (!parsed.freeText.trim() || !this.embeddingProvider) {
        return this.sqlSearch(parsed.freeText, where, params, limit);
      }
      return this.vectorSearch(parsed.freeText, where, params, limit);
    }

    // No operators — try LLM parser if available
    if (this.llmProvider) {
      try {
        // Race the LLM against a timeout: the LAN proxy can hang for tens of
        // seconds on a cold model load, and without a bound the whole search
        // request hangs forever. On timeout we throw and fall through to a
        // direct vector search on the raw free text.
        const llmParsed = await this.withLlmTimeout(this.llmProvider.parseSearchQuery(query));
        const { where: llmWhere, params: llmParams } = this.buildLlmSqlFilters(llmParsed);
        const combinedWhere = [where, llmWhere].filter(Boolean).join(" AND ");
        const combinedParams = [...params, ...llmParams];

        if (llmParsed.semanticQuery && this.embeddingProvider) {
          return this.vectorSearch(llmParsed.semanticQuery, combinedWhere, combinedParams, limit);
        }

        // Semantic query empty or no embedding provider — SQL-only with LLM filters
        return this.sqlSearch("", combinedWhere, combinedParams, limit);
      } catch (err) {
        console.error("LLM parseSearchQuery failed, falling back to SQL:", err);
      }
    }

    // No operators, no LLM — pure SQL
    if (!parsed.freeText.trim() || !this.embeddingProvider) {
      return this.sqlSearch(parsed.freeText, where, params, limit);
    }

    return this.vectorSearch(parsed.freeText, where, params, limit);
  }

  private withLlmTimeout<T>(p: Promise<T>): Promise<T> {
    if (this.llmTimeoutMs <= 0) return p;
    return Promise.race([
      p,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error("LLM parseSearchQuery timeout")), this.llmTimeoutMs)
      ),
    ]);
  }

  private buildLlmSqlFilters(llmParsed: ParsedQuery): { where: string; params: any[] } {
    const clauses: string[] = [];
    const params: any[] = [];
    const { filters } = llmParsed;

    if (filters.sender) {
      clauses.push("sender LIKE ?");
      params.push(`%${filters.sender}%`);
    }

    if (filters.subject) {
      clauses.push("subject LIKE ?");
      params.push(`%${filters.subject}%`);
    }

    if (filters.date_from) {
      clauses.push("date_received >= ?");
      params.push(new Date(`${filters.date_from}T00:00:00Z`).getTime());
    }

    if (filters.date_to) {
      clauses.push("date_received <= ?");
      params.push(new Date(`${filters.date_to}T23:59:59Z`).getTime());
    }

    return {
      where: clauses.join(" AND "),
      params,
    };
  }

  private sqlSearch(
    freeText: string,
    where: string,
    params: any[],
    limit: number
  ): SearchResult[] {
    const clauses: string[] = [];
    const allParams: any[] = [];

    if (where) {
      clauses.push(where);
      allParams.push(...params);
    }

    if (freeText.trim()) {
      clauses.push("(subject LIKE ? OR sender LIKE ? OR body_text LIKE ?)");
      const pattern = `%${freeText}%`;
      allParams.push(pattern, pattern, pattern);
    }

    const whereClause = clauses.length > 0 ? "WHERE " + clauses.join(" AND ") : "";
    const sql = `SELECT id, thread_id, sender, recipients, subject, date_received, is_read, is_starred, summary
       FROM emails ${whereClause}
       ORDER BY date_received DESC
       LIMIT ?`;

    const rows = this.db.query(sql).all(...allParams, limit) as any[];

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
    const qvec = await this.embeddingProvider!.embedQuery(freeText);
    const qbuf = Buffer.from(new Float32Array(qvec).buffer);

    // Pull top-K nearest from vec0, then inner-join with SQL filters
    const k = Math.min(Math.max(limit * 10, 50), 500);
    const knn = this.db
      .query("SELECT email_id, distance FROM vec_embeddings WHERE embedding MATCH ? AND k = ? ORDER BY distance")
      .all(qbuf, k) as Array<{ email_id: string; distance: number }>;

    if (knn.length === 0) return [];
    const ids = knn.map((r) => r.email_id);
    const distMap = new Map(knn.map((r) => [r.email_id, r.distance]));

    const placeholders = ids.map(() => "?").join(",");
    const whereClause = where ? `(${where}) AND id IN (${placeholders})` : `id IN (${placeholders})`;
    const rows = this.db
      .query(
        `SELECT id, thread_id, sender, recipients, subject, date_received, is_read, is_starred, summary
         FROM emails WHERE ${whereClause}`
      )
      .all(...params, ...ids) as any[];

    return rows
      .map((r) => ({ ...r, score: 1 - (distMap.get(r.id) ?? 1), is_read: r.is_read === 1, is_starred: r.is_starred === 1 }))
      .sort((a: any, b: any) => b.score - a.score)
      .slice(0, limit);
  }
}
