import type { DbHandle } from './db.js';
import type { AiService } from './ai.js';
import type { EmbedService } from './embed.js';
import type { SearchRequest, SearchResult, EmailListParams } from '@gmail-sweep/shared';
import { parseOperatorQuery } from './search-parser.js';

export interface SearchService {
  search(request: SearchRequest): Promise<SearchResult>;
}

const DEFAULT_PARSE_TIMEOUT_MS = 10_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    promise.then(
      v => { clearTimeout(timer); resolve(v); },
      e => { clearTimeout(timer); reject(e); }
    );
  });
}

export function createSearchService(
  db: DbHandle,
  ai: AiService,
  embed: EmbedService,
  options?: { parseTimeoutMs?: number }
): SearchService {
  const parseTimeoutMs = options?.parseTimeoutMs ?? DEFAULT_PARSE_TIMEOUT_MS;
  return {
    async search({ query, limit = 20 }) {
      // Step 1: Parse query — use operator parser first; fall back to LLM if no operators
      let parsed: { filters: EmailListParams; semanticQuery: string };

      const opQuery = parseOperatorQuery(query);
      const hasOperators = Object.keys(opQuery.operators).length > 0;

      if (hasOperators) {
        parsed = {
          filters: {
            sender: opQuery.operators.from,
            subject: opQuery.operators.subject,
            date_from: opQuery.operators.after,
            date_to: opQuery.operators.before,
            label: opQuery.operators.label,
            unread: opQuery.operators.is === 'unread' ? true : opQuery.operators.is === 'read' ? false : undefined,
            starred: opQuery.operators.is === 'starred' ? true : undefined,
            hasActions: opQuery.operators.has === 'actions' ? true : opQuery.operators.has === 'no-actions' ? false : undefined,
          },
          semanticQuery: opQuery.freeText,
        };
      } else {
        try {
          parsed = await withTimeout(ai.parseSearchQuery(query), parseTimeoutMs);
        } catch (err) {
          // LLM busy or down — degrade to pure semantic search over the raw
          // query rather than failing the request.
          console.warn('[search] parseSearchQuery failed, using raw query as semantic query:', err);
          parsed = { filters: {}, semanticQuery: query };
        }
      }

      const listParams = {
        scope: 'all' as const,  // search covers all synced mail, not just INBOX
        sender: parsed.filters.sender,
        date_from: parsed.filters.date_from,
        date_to: parsed.filters.date_to,
        subject: parsed.filters.subject,
        label: parsed.filters.label,
        unread: parsed.filters.unread,
        starred: parsed.filters.starred,
        hasActions: parsed.filters.hasActions,
        limit: candidatesLimit(limit),
      };

      // Step 2: If we have a semantic query, KNN over ALL embeddings first,
      // then apply the SQL filters to the hits. (Filtering by date first and
      // intersecting dropped semantically-best matches older than the newest
      // candidate window.)
      if (parsed.semanticQuery.trim()) {
        try {
          const queryVector = await embed.embedQuery(parsed.semanticQuery);
          const knnResults = db.searchEmbeddings(queryVector, candidatesLimit(limit));

          if (knnResults.length > 0) {
            const knnIds = knnResults.map(r => r.emailId);
            const knnParams = { ...listParams, ids: knnIds, limit: knnIds.length };
            let matched = db.listEmails(knnParams);

            // The LLM often guesses a subject phrase that no real subject
            // contains via LIKE. An explicit subject: operator stays strict,
            // but an LLM-guessed subject is soft — drop it and let the
            // vector stage rank.
            if (matched.length === 0 && !hasOperators && parsed.filters.subject) {
              matched = db.listEmails({ ...knnParams, subject: undefined });
            }

            if (matched.length > 0) {
              const distanceMap = new Map(knnResults.map(r => [r.emailId, r.distance]));
              // Sort ascending by distance (closer = more similar)
              const results = matched
                .map(email => ({ email, distance: distanceMap.get(email.id)! }))
                .sort((a, b) => a.distance - b.distance)
                .slice(0, limit);
              return {
                emails: results.map(r => r.email),
                // Convert distance to similarity score (1 - distance for cosine)
                scores: results.map(r => 1 - r.distance),
              };
            }
          }
        } catch (err) {
          console.warn('[search] embedding failed, falling back to SQL results:', err);
        }
      }

      // Fallback (no semantic query, no embeddings yet, or embed failure):
      // SQL-filtered results with equal scores
      let candidates = db.listEmails(listParams);
      if (candidates.length === 0 && !hasOperators && parsed.filters.subject && parsed.semanticQuery.trim()) {
        candidates = db.listEmails({ ...listParams, subject: undefined });
      }
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
