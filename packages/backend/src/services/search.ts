import type { DbHandle } from './db.js';
import type { AiService } from './ai.js';
import type { EmbedService } from './embed.js';
import type { SearchRequest, SearchResult, EmailListParams } from '@gmail-sweep/shared';
import { parseOperatorQuery } from './search-parser.js';

export interface SearchService {
  search(request: SearchRequest): Promise<SearchResult>;
}

export function createSearchService(db: DbHandle, ai: AiService, embed: EmbedService): SearchService {
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
          parsed = await ai.parseSearchQuery(query);
        } catch (err) {
          console.warn('[search] parseSearchQuery failed:', err);
          throw err;
        }
      }

      // Step 2: SQL filter on structured columns (fast indexed queries)
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
      let candidates = db.listEmails(listParams);

      // The LLM often guesses a subject phrase that no real subject contains
      // via LIKE. An explicit subject: operator stays strict, but an
      // LLM-guessed subject is soft — drop it and let the vector stage rank.
      if (candidates.length === 0 && !hasOperators && parsed.filters.subject && parsed.semanticQuery.trim()) {
        candidates = db.listEmails({ ...listParams, subject: undefined });
      }

      if (candidates.length === 0) {
        return { emails: [], scores: [] };
      }

      // Step 3: If we have a semantic query, embed it and score via vec0 KNN
      if (parsed.semanticQuery.trim()) {
        try {
          const queryVector = await embed.embedQuery(parsed.semanticQuery);

          // Get top-k nearest neighbours from vec0
          const knnResults = db.searchEmbeddings(queryVector, candidatesLimit(limit));

          if (knnResults.length > 0) {
            const distanceMap = new Map(knnResults.map(r => [r.emailId, r.distance]));

            // Filter candidates to those with an embedding, score by distance
            const scored = candidates
              .filter(email => distanceMap.has(email.id))
              .map(email => ({ email, distance: distanceMap.get(email.id)! }));

            if (scored.length > 0) {
              // Sort ascending by distance (closer = more similar)
              const results = scored.sort((a, b) => a.distance - b.distance).slice(0, limit);
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
