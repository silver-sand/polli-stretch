/**
 * Chunking tests for PolliStretch.
 *
 * Tests the paragraph chunking logic that groups paragraphs into
 * generation-sized requests respecting char budget and heading boundaries.
 */

import { describe, it, expect } from "vitest";
import { chunkParagraphs, DEFAULT_MAX_CHARS } from "../../src/lib/chunk";
import type { RawParagraph } from "../../src/types";

function makeParagraph(text: string, heading?: string, id?: string): RawParagraph {
  return {
    id: id ?? `p${Math.random().toString(36).slice(2)}`,
    text,
    html: `<p>${text}</p>`,
    charCount: text.length,
    heading,
  };
}

describe("chunkParagraphs", () => {
  it("returns empty array for empty input", () => {
    const result = chunkParagraphs([]);
    expect(result).toEqual([]);
  });

  it("single paragraph under budget stays in one chunk", () => {
    const paragraphs = [makeParagraph("Short paragraph.", "Heading 1")];
    const result = chunkParagraphs(paragraphs);
    expect(result.length).toBe(1);
    expect(result[0].paragraphs.length).toBe(1);
    expect(result[0].charCount).toBe("Short paragraph.".length);
  });

  it("multiple paragraphs under budget merge into one chunk", () => {
    const paragraphs = [
      makeParagraph("First paragraph with some text.", "Section A"),
      makeParagraph("Second paragraph continues.", "Section A"),
      makeParagraph("Third paragraph ends the section.", "Section A"),
    ];
    const result = chunkParagraphs(paragraphs);
    expect(result.length).toBe(1);
    expect(result[0].paragraphs.length).toBe(3);
  });

  it("splits when char budget exceeded", () => {
    const longText = "x".repeat(4000);
    const paragraphs = [
      makeParagraph(longText, "Section A"),
      makeParagraph(longText, "Section A"),
    ];
    const result = chunkParagraphs(paragraphs, 6000);
    // Each 4000-char paragraph: 4000+4000 = 8000 > 6000, so they split
    expect(result.length).toBe(2);
    expect(result[0].paragraphs.length).toBe(1);
    expect(result[1].paragraphs.length).toBe(1);
  });

  it("splits on heading change even if under budget", () => {
    const paragraphs = [
      makeParagraph("First section content.", "Section A"),
      makeParagraph("Second section content.", "Section B"),
      makeParagraph("Third section content.", "Section A"),
    ];
    const result = chunkParagraphs(paragraphs);
    expect(result.length).toBe(3);
    expect(result[0].paragraphs[0].heading).toBe("Section A");
    expect(result[1].paragraphs[0].heading).toBe("Section B");
    expect(result[2].paragraphs[0].heading).toBe("Section A");
  });

  it("keeps same heading together even if multiple heading changes happen", () => {
    const paragraphs = [
      makeParagraph("A1", "H1"),
      makeParagraph("A2", "H1"),
      makeParagraph("B1", "H2"),
      makeParagraph("B2", "H2"),
      makeParagraph("C1", "H3"),
    ];
    const result = chunkParagraphs(paragraphs);
    expect(result.length).toBe(3);
    expect(result[0].paragraphs.length).toBe(2);
    expect(result[1].paragraphs.length).toBe(2);
    expect(result[2].paragraphs.length).toBe(1);
  });

  it("heading change flushes current chunk before starting new one", () => {
    const paragraphs = [
      makeParagraph("Para 1", "H1"),
      makeParagraph("Para 2", "H1"),
      makeParagraph("Para 3", "H2"),
      makeParagraph("Para 4", "H2"),
    ];
    const result = chunkParagraphs(paragraphs, 10000); // large budget
    expect(result.length).toBe(2);
    expect(result[0].paragraphs.map(p => p.id)).toEqual([paragraphs[0].id, paragraphs[1].id]);
    expect(result[1].paragraphs.map(p => p.id)).toEqual([paragraphs[2].id, paragraphs[3].id]);
  });

  it("respects custom maxChars parameter", () => {
    const paragraphs = [
      makeParagraph("aaaa", "H1"), // 4 chars
      makeParagraph("bbbb", "H1"), // 4 chars
      makeParagraph("cccc", "H1"), // 4 chars
    ];
    // Budget of 6 should split: 4+4=8 > 6, so first alone, then 4+4=8 > 6
    const result = chunkParagraphs(paragraphs, 6);
    expect(result.length).toBe(3);
  });

  it("handles undefined heading correctly", () => {
    const paragraphs = [
      makeParagraph("First", undefined),
      makeParagraph("Second", "H1"),
      makeParagraph("Third", undefined),
    ];
    const result = chunkParagraphs(paragraphs);
    // undefined !== "H1" !== undefined => three chunks
    expect(result.length).toBe(3);
  });

  it("chunk IDs are sequential", () => {
    const paragraphs = Array.from({ length: 5 }, (_, i) => makeParagraph(`P${i}`, "H1"));
    // Each "P0".."P4" is 2 chars; budget 3 forces 2+2 > 3 => one paragraph per chunk
    const result = chunkParagraphs(paragraphs, 3);
    expect(result.map(c => c.id)).toEqual(["c0", "c1", "c2", "c3", "c4"]);
  });

  it("charCount sums paragraph charCounts", () => {
    const paragraphs = [
      makeParagraph("aaa", "H1"), // 3
      makeParagraph("bbbb", "H1"), // 4
    ];
    const result = chunkParagraphs(paragraphs);
    expect(result[0].charCount).toBe(7);
  });

  it("preserves original paragraph objects (not mutated)", () => {
    const paragraphs = [makeParagraph("Original", "H1")];
    const result = chunkParagraphs(paragraphs);
    // Mutate result
    result[0].paragraphs[0].text = "Mutated";
    // Original should be unchanged
    expect(paragraphs[0].text).toBe("Original");
  });
});