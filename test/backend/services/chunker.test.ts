import { describe, test, expect } from "bun:test";
import {
  chunkEmail,
  CHUNK_MAX_CHARS,
  MAX_CHUNKS_PER_EMAIL,
} from "../../../src/backend/services/chunker";
import type { ExtractionStrategy } from "../../../src/shared/types";

const TPL: ExtractionStrategy = { type: "template", template: "{{subject}}|{{body_text}}" };
const BODY_TPL: ExtractionStrategy = { type: "template", template: "{{body_text}}" };

describe("chunkEmail", () => {
  test("body under the cap yields a single chunk with the full body", () => {
    const body = "x".repeat(500);
    const out = chunkEmail({ subject: "S", bodyText: body }, TPL);
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(`S|${body}`);
  });

  test("empty body yields one subject-only chunk", () => {
    const out = chunkEmail({ subject: "S", bodyText: "" }, TPL);
    expect(out).toHaveLength(1);
    expect(out[0]).toBe("S|");
  });

  test("every chunk body stays within CHUNK_MAX_CHARS", () => {
    // Three 400-char paragraphs: p1+p2 pack (802), p3 overflows -> 2 chunks.
    const p1 = "AAAA" + "x".repeat(396);
    const p2 = "BBBB" + "x".repeat(396);
    const p3 = "CCCC" + "x".repeat(396);
    const body = `${p1}\n\n${p2}\n\n${p3}`;
    const out = chunkEmail({ subject: "", bodyText: body }, BODY_TPL);

    expect(out.length).toBe(2);
    for (const chunk of out) {
      expect(chunk.length).toBeLessThanOrEqual(CHUNK_MAX_CHARS);
    }
  });

  test("paragraphs are kept whole — no paragraph split across chunks", () => {
    const p1 = "AAAA" + "x".repeat(396);
    const p2 = "BBBB" + "x".repeat(396);
    const p3 = "CCCC" + "x".repeat(396);
    const body = `${p1}\n\n${p2}\n\n${p3}`;
    const out = chunkEmail({ subject: "", bodyText: body }, BODY_TPL);

    // Each marker must appear in exactly one chunk (never duplicated, never split).
    for (const marker of ["AAAA", "BBBB", "CCCC"]) {
      const hits = out.filter((c) => c.includes(marker)).length;
      expect(hits).toBe(1);
    }
    // First chunk holds the first two paragraphs; second holds the third.
    expect(out[0]).toContain("AAAA");
    expect(out[0]).toContain("BBBB");
    expect(out[1]).toContain("CCCC");
  });

  test("a single oversized paragraph with no breaks is hard-truncated to the cap", () => {
    const body = "y".repeat(CHUNK_MAX_CHARS * 2 + 500);
    const out = chunkEmail({ subject: "", bodyText: body }, BODY_TPL);
    expect(out).toHaveLength(1);
    expect(out[0].length).toBe(CHUNK_MAX_CHARS);
  });

  test("an oversized paragraph is isolated and truncated rather than packed", () => {
    // A small paragraph, then a giant one, then a small one.
    const small1 = "first";
    const huge = "z".repeat(CHUNK_MAX_CHARS * 3);
    const small2 = "last";
    const body = `${small1}\n\n${huge}\n\n${small2}`;
    const out = chunkEmail({ subject: "", bodyText: body }, BODY_TPL);

    expect(out.length).toBe(3);
    expect(out[0]).toBe("first");
    expect(out[1].length).toBe(CHUNK_MAX_CHARS); // huge truncated
    expect(out[2]).toBe("last");
  });

  test("the subject is templated into every chunk", () => {
    const p1 = "pp" + "x".repeat(600);
    const p2 = "qq" + "x".repeat(600);
    const body = `${p1}\n\n${p2}`;
    const out = chunkEmail({ subject: "SUB", bodyText: body }, TPL);

    expect(out.length).toBeGreaterThan(1);
    for (const chunk of out) {
      expect(chunk.startsWith("SUB|")).toBe(true);
    }
  });

  test("caps the number of chunks at MAX_CHUNKS_PER_EMAIL", () => {
    // 600-char paragraphs can't pair (1202 > cap), so each becomes its own chunk.
    const paras = Array.from({ length: MAX_CHUNKS_PER_EMAIL + 5 }, (_, i) =>
      `p${i}` + "x".repeat(596)
    );
    const body = paras.join("\n\n");
    const out = chunkEmail({ subject: "", bodyText: body }, BODY_TPL);
    expect(out.length).toBe(MAX_CHUNKS_PER_EMAIL);
  });

  test("is deterministic — same input yields identical output", () => {
    const p1 = "aa" + "x".repeat(600);
    const p2 = "bb" + "x".repeat(600);
    const body = `${p1}\n\n${p2}`;
    const a = chunkEmail({ subject: "S", bodyText: body }, TPL);
    const b = chunkEmail({ subject: "S", bodyText: body }, TPL);
    expect(a).toEqual(b);
  });

  test("collapses blank lines / whitespace-only paragraphs without producing empty chunks", () => {
    const body = "real one\n\n\n\n   \n\n" + "y".repeat(CHUNK_MAX_CHARS + 10);
    const out = chunkEmail({ subject: "", bodyText: body }, BODY_TPL);
    expect(out.length).toBeGreaterThan(0);
    for (const chunk of out) {
      expect(chunk.length).toBeGreaterThan(0);
    }
  });
});
