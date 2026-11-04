/**
 * Prompt tests for PolliStretch.
 *
 * Tests the system/user prompt construction for stretchtext generation.
 */

import { describe, it, expect } from "vitest";
import { buildStretchPrompt, SCHEMA } from "../../src/lib/prompt";
import type { RawChunk, RawParagraph } from "../../src/types";

function makeParagraph(text: string, id = "p0", heading?: string): RawParagraph {
  return {
    id,
    text,
    html: `<p>${text}</p>`,
    charCount: text.length,
    heading,
  };
}

describe("buildStretchPrompt", () => {
  it("includes the schema in the system prompt", () => {
    const chunk: RawChunk = {
      id: "c0",
      paragraphs: [makeParagraph("Test paragraph.", "p0")],
      charCount: 14,
    };
    const { system } = buildStretchPrompt(chunk);
    expect(system).toContain(SCHEMA);
  });

  it("includes chunk id in user prompt", () => {
    const chunk: RawChunk = {
      id: "c42",
      paragraphs: [makeParagraph("Test paragraph.", "p0")],
      charCount: 14,
    };
    const { user } = buildStretchPrompt(chunk);
    expect(user).toContain("Chunk id: c42");
  });

  it("includes all paragraph ids in user prompt", () => {
    const chunk: RawChunk = {
      id: "c0",
      paragraphs: [
        makeParagraph("First paragraph.", "p0"),
        makeParagraph("Second paragraph.", "p1"),
        makeParagraph("Third paragraph.", "p2"),
      ],
      charCount: 44,
    };
    const { user } = buildStretchPrompt(chunk);
    expect(user).toContain("Paragraph id: p0");
    expect(user).toContain("Paragraph id: p1");
    expect(user).toContain("Paragraph id: p2");
  });

  it("includes paragraph text in user prompt", () => {
    const chunk: RawChunk = {
      id: "c0",
      paragraphs: [makeParagraph("This is the paragraph text.", "p0")],
      charCount: 28,
    };
    const { user } = buildStretchPrompt(chunk);
    expect(user).toContain("Text: This is the paragraph text.");
  });

  it("includes heading when present", () => {
    const chunk: RawChunk = {
      id: "c0",
      paragraphs: [makeParagraph("Content under heading.", "p0", "Section Title")],
      charCount: 22,
    };
    const { user } = buildStretchPrompt(chunk);
    expect(user).toContain("Heading: Section Title");
  });

  it("omits heading when undefined", () => {
    const chunk: RawChunk = {
      id: "c0",
      paragraphs: [makeParagraph("Content without heading.", "p0")],
      charCount: 24,
    };
    const { user } = buildStretchPrompt(chunk);
    expect(user).not.toContain("Heading:");
  });

  it("separates paragraphs with --- delimiter", () => {
    const chunk: RawChunk = {
      id: "c0",
      paragraphs: [
        makeParagraph("First.", "p0"),
        makeParagraph("Second.", "p1"),
      ],
      charCount: 12,
    };
    const { user } = buildStretchPrompt(chunk);
    expect(user).toContain("---\n\n");
  });

  it("includes paragraph count in user prompt", () => {
    const chunk: RawChunk = {
      id: "c0",
      paragraphs: [
        makeParagraph("First.", "p0"),
        makeParagraph("Second.", "p1"),
        makeParagraph("Third.", "p2"),
      ],
      charCount: 18,
    };
    const { user } = buildStretchPrompt(chunk);
    expect(user).toContain("Here are 3 paragraphs");
  });

  it("system prompt contains key rules", () => {
    const chunk: RawChunk = {
      id: "c0",
      paragraphs: [makeParagraph("Test.", "p0")],
      charCount: 4,
    };
    const { system } = buildStretchPrompt(chunk);
    // Check for critical rules
    expect(system).toContain("ONLY a single JSON object");
    expect(system).toContain("No markdown fences");
    expect(system).toContain("kernel");
    expect(system).toContain("context");
    expect(system).toContain("Do not invent, add, or remove any fact");
    expect(system).toContain("preserve ALL named entities");
    expect(system).toContain("Echo the chunk id and every paragraph id exactly");
  });

  it("user prompt ends with instruction to return JSON", () => {
    const chunk: RawChunk = {
      id: "c0",
      paragraphs: [makeParagraph("Test.", "p0")],
      charCount: 4,
    };
    const { user } = buildStretchPrompt(chunk);
    expect(user.trim().endsWith("Return the JSON object now.")).toBe(true);
  });

  it("handles empty paragraph list gracefully", () => {
    const chunk: RawChunk = {
      id: "c0",
      paragraphs: [],
      charCount: 0,
    };
    const { user } = buildStretchPrompt(chunk);
    expect(user).toContain("Here are 0 paragraphs");
  });

  it("preserves special characters in paragraph text", () => {
    const chunk: RawChunk = {
      id: "c0",
      paragraphs: [makeParagraph('He said "Hello, world!" & then left.', "p0")],
      charCount: 36,
    };
    const { user } = buildStretchPrompt(chunk);
    expect(user).toContain('He said "Hello, world!" & then left.');
  });

  it("system prompt is stable across calls", () => {
    const chunk: RawChunk = {
      id: "c0",
      paragraphs: [makeParagraph("Test.", "p0")],
      charCount: 4,
    };
    const { system: s1 } = buildStretchPrompt(chunk);
    const { system: s2 } = buildStretchPrompt(chunk);
    expect(s1).toBe(s2);
  });

  it("user prompt varies with chunk content", () => {
    const chunk1: RawChunk = {
      id: "c0",
      paragraphs: [makeParagraph("First.", "p0")],
      charCount: 6,
    };
    const chunk2: RawChunk = {
      id: "c0",
      paragraphs: [makeParagraph("Second.", "p0")],
      charCount: 7,
    };
    const { user: u1 } = buildStretchPrompt(chunk1);
    const { user: u2 } = buildStretchPrompt(chunk2);
    expect(u1).not.toBe(u2);
  });
});

describe("SCHEMA constant", () => {
  it("is valid JSON structure", () => {
    // The schema is a template string, not actual JSON, but it should be well-formed
    expect(SCHEMA).toContain('"chunks"');
    expect(SCHEMA).toContain('"id"');
    expect(SCHEMA).toContain('"paragraphs"');
    expect(SCHEMA).toContain('"kernel"');
    expect(SCHEMA).toContain('"context"');
  });
});