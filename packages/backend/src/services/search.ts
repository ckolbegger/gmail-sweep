import type { DbHandle } from './db.js';
import type { AiService } from './ai.js';
import type { EmbedService } from './embed.js';
import type { SearchRequest, SearchResult } from '@gmail-sweep/shared';

export interface SearchService {
  search(request: SearchRequest): Promise<SearchResult>;
}

export function createSearchService(db: DbHandle, ai: AiService, embed: EmbedService): SearchService {
  return {
    async search({ query, limit = 20, strategy }) {
      // Step 1: AI parses the query into structured filters + semantic query
      const parsed = await ai.parseSearchQuery(query);

      // Step 2: SQL filter on structured columns (fast indexed queries)
      const candidates = db.listEmails({
        sender: parsed.filters.sender,
        date_from: parsed.filters.date_from,
        date_to: parsed.filters.date_to,
        subject: parsed.filters.subject,
        limit: candidatesLimit(limit),
      });

      if (candidates.length === 0) {
        return { emails: [], scores: [] };
      }

      // Step 3: If we have a semantic query, embed it and score candidates
      if (parsed.semanticQuery.trim()) {
        try {
          const activeStrategy = strategy ?? 'v1-plain';
          const queryVector = await embed.embedQuery(parsed.semanticQuery);

          // Load stored embeddings for candidates that have them
          const storedEmbeddings = db.getEmbeddingsForStrategy(activeStrategy, 2000);
          const embeddingMap = new Map(storedEmbeddings.map(e => [e.emailId, e.vector]));

          const scored = candidates.map(email => {
            const vec = embeddingMap.get(email.id);
            return { email, score: vec ? cosineSimilarity(queryVector, vec) : 0 };
          });

          const results = scored.sort((a, b) => b.score - a.score).slice(0, limit);
          return {
            emails: results.map(r => r.email),
            scores: results.map(r => r.score),
          };
        } catch {
          // Embedding failed — fall back to SQL results only
        }
      }

      // Fallback: return SQL-filtered results with equal scores
      const sliced = candidates.slice(0, limit);
      return {
        emails: sliced,
        scores: sliced.map(() => 1.0),
      };
    },
  };
}

function candidatesLimit(resultLimit: number): number {
  return Math.min(resultLimit * 10, 2000);
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * (b[i] ?? 0);
    normA += a[i]! ** 2;
    normB += (b[i] ?? 0) ** 2;
  }
  return normA === 0 || normB === 0 ? 0 : dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
