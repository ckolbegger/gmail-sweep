import { describe, test, expect } from "bun:test";
import { buildEmbeddingText } from "../../../src/backend/services/extraction-strategies";

describe("buildEmbeddingText", () => {
  test("replaces {{subject}} and {{body_text}}", () => {
    const out = buildEmbeddingText(
      { subject: "Hi", bodyText: "Hello world" },
      { type: "template", template: "S: {{subject}}\n\n{{body_text}}" }
    );
    expect(out).toBe("S: Hi\n\nHello world");
  });

  test("truncates body to 8000 chars", () => {
    const body = "x".repeat(9000);
    const out = buildEmbeddingText(
      { subject: "", bodyText: body },
      { type: "template", template: "{{body_text}}" }
    );
    expect(out.length).toBe(8000);
  });

  test("handles missing subject gracefully", () => {
    const out = buildEmbeddingText(
      { subject: "", bodyText: "b" },
      { type: "template", template: "{{subject}}|{{body_text}}" }
    );
    expect(out).toBe("|b");
  });
});
