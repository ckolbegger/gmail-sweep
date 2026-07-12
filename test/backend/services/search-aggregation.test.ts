import { describe, test, expect } from "bun:test";
import { bestChunkPerEmail } from "../../../src/backend/services/search";

describe("bestChunkPerEmail", () => {
  test("empty input yields an empty map", () => {
    expect(bestChunkPerEmail([]).size).toBe(0);
  });

  test("a single row is kept as-is", () => {
    const m = bestChunkPerEmail([{ email_id: "e1", distance: 0.4 }]);
    expect(m.get("e1")).toBe(0.4);
    expect(m.size).toBe(1);
  });

  test("distinct emails are all kept", () => {
    const m = bestChunkPerEmail([
      { email_id: "e1", distance: 0.1 },
      { email_id: "e2", distance: 0.5 },
      { email_id: "e3", distance: 0.9 },
    ]);
    expect(m.size).toBe(3);
    expect(m.get("e1")).toBe(0.1);
    expect(m.get("e2")).toBe(0.5);
    expect(m.get("e3")).toBe(0.9);
  });

  test("duplicate emails collapse to the minimum distance (best match)", () => {
    // vec0 cosine: lower distance = more similar. The best chunk wins.
    const m = bestChunkPerEmail([
      { email_id: "e1", distance: 0.6 },
      { email_id: "e1", distance: 0.2 },
      { email_id: "e1", distance: 0.8 },
    ]);
    expect(m.size).toBe(1);
    expect(m.get("e1")).toBe(0.2);
  });

  test("mixed duplicates and distinct emails aggregate independently", () => {
    const m = bestChunkPerEmail([
      { email_id: "e1", distance: 0.5 },
      { email_id: "e2", distance: 0.7 },
      { email_id: "e1", distance: 0.3 },
      { email_id: "e2", distance: 0.1 },
    ]);
    expect(m.size).toBe(2);
    expect(m.get("e1")).toBe(0.3);
    expect(m.get("e2")).toBe(0.1);
  });
});
