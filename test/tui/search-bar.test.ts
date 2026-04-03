import { describe, it, expect } from "bun:test";
import { SEARCH_BAR_OPTIONS } from "../../src/tui/components/search-bar";

describe("search bar textbox options", () => {
  it("does not set inputOnFocus — readInput() controls input mode", () => {
    expect(SEARCH_BAR_OPTIONS.inputOnFocus).toBeFalsy();
  });
});
