import { describe, it, expect } from "bun:test";
import { parseQuery, buildSqlFilters } from "@backend/services/search-parser";

describe("parseQuery", () => {
  it("should extract from: operator", () => {
    const result = parseQuery("from:alice@example.com");
    expect(result.operators.from).toBe("alice@example.com");
    expect(result.freeText).toBe("");
  });

  it("should extract to: operator", () => {
    const result = parseQuery("to:bob@example.com");
    expect(result.operators.to).toBe("bob@example.com");
    expect(result.freeText).toBe("");
  });

  it("should extract subject: operator", () => {
    const result = parseQuery("subject:meeting");
    expect(result.operators.subject).toBe("meeting");
    expect(result.freeText).toBe("");
  });

  it("should extract before: operator and parse date", () => {
    const result = parseQuery("before:2025-06-15");
    expect(result.operators.before).toBe("2025-06-15");
    expect(result.freeText).toBe("");
  });

  it("should extract after: operator and parse date", () => {
    const result = parseQuery("after:2025-01-01");
    expect(result.operators.after).toBe("2025-01-01");
    expect(result.freeText).toBe("");
  });

  it("should extract label: operator", () => {
    const result = parseQuery("label:inbox");
    expect(result.operators.label).toBe("inbox");
    expect(result.freeText).toBe("");
  });

  it("should extract is:unread operator", () => {
    const result = parseQuery("is:unread");
    expect(result.operators.is).toBe("unread");
    expect(result.freeText).toBe("");
  });

  it("should extract is:read operator", () => {
    const result = parseQuery("is:read");
    expect(result.operators.is).toBe("read");
    expect(result.freeText).toBe("");
  });

  it("should extract has:actions operator", () => {
    const result = parseQuery("has:actions");
    expect(result.operators.has).toBe("actions");
    expect(result.freeText).toBe("");
  });

  it("should extract has:no-actions operator", () => {
    const result = parseQuery("has:no-actions");
    expect(result.operators.has).toBe("no-actions");
    expect(result.freeText).toBe("");
  });

  it("should extract multiple operators from single query", () => {
    const result = parseQuery("from:alice is:unread subject:report");
    expect(result.operators.from).toBe("alice");
    expect(result.operators.is).toBe("unread");
    expect(result.operators.subject).toBe("report");
  });

  it("should return remaining text as freeText after removing operators", () => {
    const result = parseQuery("from:alice important project update");
    expect(result.operators.from).toBe("alice");
    expect(result.freeText).toBe("important project update");
  });

  it("should return empty freeText when only operators present", () => {
    const result = parseQuery("from:alice is:unread");
    expect(result.operators.from).toBe("alice");
    expect(result.operators.is).toBe("unread");
    expect(result.freeText).toBe("");
  });

  it("should only extract operators at token boundaries", () => {
    const result = parseQuery('message about "from:alice" stuff');
    // "from:alice" inside quotes should NOT be extracted as an operator
    // because it's not at a token boundary (it's inside a quoted phrase or mid-word)
    expect(result.operators.from).toBeUndefined();
    expect(result.freeText).toContain("from:alice");
  });

  it("should handle empty query", () => {
    const result = parseQuery("");
    expect(result.operators).toEqual({});
    expect(result.freeText).toBe("");
  });

  it("should handle query with only free text", () => {
    const result = parseQuery("hello world");
    expect(result.operators).toEqual({});
    expect(result.freeText).toBe("hello world");
  });

  it("should handle quoted operator value: from:\"AI Fire\"", () => {
    const result = parseQuery('from:"AI Fire"');
    expect(result.operators.from).toBe("AI Fire");
    expect(result.freeText).toBe("");
  });

  it("should handle quoted operator value with spaces: subject:\"project update\"", () => {
    const result = parseQuery('subject:"project update"');
    expect(result.operators.subject).toBe("project update");
    expect(result.freeText).toBe("");
  });

  it("should handle mixed quoted operators and free text", () => {
    const result = parseQuery('from:"AI Fire" important stuff');
    expect(result.operators.from).toBe("AI Fire");
    expect(result.freeText).toBe("important stuff");
  });

  it("should handle multiple quoted operators", () => {
    const result = parseQuery('from:"AI Fire" subject:"weekly digest"');
    expect(result.operators.from).toBe("AI Fire");
    expect(result.operators.subject).toBe("weekly digest");
    expect(result.freeText).toBe("");
  });

  it("should handle unquoted multi-word after operator colon — backward compatible", () => {
    // from:AI Fire with no quotes — Fire is free text (backward compatible)
    const result = parseQuery("from:AI Fire");
    expect(result.operators.from).toBe("AI");
    expect(result.freeText).toBe("Fire");
  });

  it("should handle free text with quoted phrases that are not operators", () => {
    const result = parseQuery('"AI Fire" newsletter');
    expect(result.operators).toEqual({});
    expect(result.freeText).toBe('"AI Fire" newsletter');
  });
});

describe("buildSqlFilters", () => {
  it("should build SQL WHERE clauses from extracted operators", () => {
    const parsed = parseQuery("from:alice");
    const { where, params } = buildSqlFilters(parsed);
    expect(where).toContain("sender LIKE ?");
    expect(params).toContain("%alice%");
  });

  it("should combine multiple filters with AND", () => {
    const parsed = parseQuery("from:alice is:unread");
    const { where, params } = buildSqlFilters(parsed);
    expect(where).toContain("AND");
    expect(where).toContain("sender LIKE ?");
    expect(where).toContain("is_read = 0");
  });

  it("should use LIKE for from: operator", () => {
    const parsed = parseQuery("from:alice");
    const { where, params } = buildSqlFilters(parsed);
    expect(where).toContain("sender LIKE ?");
    expect(params[0]).toBe("%alice%");
  });

  it("should use LIKE for to: operator", () => {
    const parsed = parseQuery("to:bob");
    const { where, params } = buildSqlFilters(parsed);
    expect(where).toContain("recipients LIKE ?");
    expect(params[0]).toBe("%bob%");
  });

  it("should use LIKE for subject: operator", () => {
    const parsed = parseQuery("subject:meeting");
    const { where, params } = buildSqlFilters(parsed);
    expect(where).toContain("subject LIKE ?");
    expect(params[0]).toBe("%meeting%");
  });

  it("should use date comparison for before:", () => {
    const parsed = parseQuery("before:2025-06-15");
    const { where, params } = buildSqlFilters(parsed);
    expect(where).toContain("date_received < ?");
    // 2025-06-15 00:00:00 UTC in ms
    expect(params[0]).toBe(new Date("2025-06-15T00:00:00Z").getTime());
  });

  it("should use date comparison for after:", () => {
    const parsed = parseQuery("after:2025-01-01");
    const { where, params } = buildSqlFilters(parsed);
    expect(where).toContain("date_received > ?");
    // 2025-01-01 00:00:00 UTC in ms
    expect(params[0]).toBe(new Date("2025-01-01T00:00:00Z").getTime());
  });

  it("should use json_each for label:", () => {
    const parsed = parseQuery("label:inbox");
    const { where, params } = buildSqlFilters(parsed);
    expect(where).toContain("json_each");
    expect(where).toContain("json_extract");
    expect(params).toContain("inbox");
  });

  it("should use is_read = 0 for is:unread", () => {
    const parsed = parseQuery("is:unread");
    const { where } = buildSqlFilters(parsed);
    expect(where).toContain("is_read = 0");
  });

  it("should use is_read = 1 for is:read", () => {
    const parsed = parseQuery("is:read");
    const { where } = buildSqlFilters(parsed);
    expect(where).toContain("is_read = 1");
  });

  it("should use json_array_length for has:actions", () => {
    const parsed = parseQuery("has:actions");
    const { where } = buildSqlFilters(parsed);
    expect(where).toContain("json_array_length(action_items) > 0");
  });

  it("should use json_array_length for has:no-actions", () => {
    const parsed = parseQuery("has:no-actions");
    const { where } = buildSqlFilters(parsed);
    expect(where).toContain("json_array_length(action_items) = 0");
  });

  it("should return empty where for empty parsed query", () => {
    const parsed = parseQuery("");
    const { where, params } = buildSqlFilters(parsed);
    expect(where).toBe("");
    expect(params).toEqual([]);
  });

  it("should handle before: date at end of day (exclusive upper bound)", () => {
    const parsed = parseQuery("before:2025-06-15");
    const { params } = buildSqlFilters(parsed);
    // before:2025-06-15 means before start of that day
    const expected = new Date("2025-06-15T00:00:00Z").getTime();
    expect(params[0]).toBe(expected);
  });

  it("should handle after: date at start of day (inclusive lower bound)", () => {
    const parsed = parseQuery("after:2025-01-01");
    const { params } = buildSqlFilters(parsed);
    const expected = new Date("2025-01-01T00:00:00Z").getTime();
    expect(params[0]).toBe(expected);
  });
});
