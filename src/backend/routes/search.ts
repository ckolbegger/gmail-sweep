import { Hono } from "hono";
import type { SearchService } from "@backend/services/search";

export function createSearchRouter(searchService: SearchService) {
  const router = new Hono();

  router.post("/search", async (c) => {
    const body = await c.req.json();
    const query = body?.query;
    if (query === undefined || query === null) {
      return c.json({ error: "Query is required" }, 400);
    }
    // Reject whitespace-only strings (but allow empty "" which returns all)
    if (typeof query === "string" && query.length > 0 && query.trim() === "") {
      return c.json({ error: "Query is required" }, 400);
    }
    const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
    const results = await searchService.search(query, limit);
    return c.json({ results, total: results.length });
  });

  return router;
}
