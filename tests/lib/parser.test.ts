/**
 * Parser tests for PolliStretch.
 *
 * Tests the defensive JSON parsing, fence stripping, balanced-bracket extraction,
 * validation, and safe fallbacks for model responses.
 */

import { describe, it, expect } from "vitest";
import {
  extractBalancedJson,
  stripFences,
  parseStretchResponse,
} from "../../src/lib/parser";
import type { RawParagraph } from "../../src/types";

function makeParagraph(text: string, id = "p0", heading?: string): RawParagraph {
  return {
    id,
    text,
    html: `<p>${text}</p>`,
    charCount: text.length,
    heading,
  };
}

const EXPECTED_PARAGRAPHS = [
  makeParagraph("First paragraph with some content.", "p0", "Heading 1"),
  makeParagraph("Second paragraph continues the thought.", "p1", "Heading 1"),
];

const HTML_BY_ID = new Map<string, string>([
  ["p0", "<p>First paragraph with some content.</p>"],
  ["p1", "<p>Second paragraph continues the thought.</p>"],
]);

describe("stripFences", () => {
  it("strips ```json fences", () => {
    const input = "```json\n{ \"foo\": 1 }\n```";
    expect(stripFences(input)).toBe('{ "foo": 1 }');
  });

  it("strips ``` fences without language", () => {
    const input = "```\n{ \"bar\": 2 }\n```";
    expect(stripFences(input)).toBe('{ "bar": 2 }');
  });

  it("strips fences with no trailing newline", () => {
    const input = "```json\n{ \"baz\": 3 }```";
    expect(stripFences(input)).toBe('{ "baz": 3 }');
  });

  it("returns original string when no fences", () => {
    const input = '{ "plain": true }';
    expect(stripFences(input)).toBe('{ "plain": true }');
  });

  it("handles empty string", () => {
    expect(stripFences("")).toBe("");
  });

  it("handles whitespace only", () => {
    expect(stripFences("   ")).toBe("   ");
  });
});

describe("extractBalancedJson", () => {
  it("extracts simple object", () => {
    const input = 'prefix {"a":1} suffix';
    expect(extractBalancedJson(input)).toBe('{"a":1}');
  });

  it("extracts nested object", () => {
    const input = 'text {"outer":{"inner":true}} end';
    expect(extractBalancedJson(input)).toBe('{"outer":{"inner":true}}');
  });

  it("handles strings with braces inside", () => {
    const input = '{"message":"hello {world}"}';
    expect(extractBalancedJson(input)).toBe('{"message":"hello {world}"}');
  });

  it("handles escaped quotes in strings", () => {
    const input = '{"quote":"she said \\"hi\\""}';
    expect(extractBalancedJson(input)).toBe('{"quote":"she said \\"hi\\""}');
  });

  it("handles escaped backslashes", () => {
    const input = '{"path":"C:\\\\Users"}';
    expect(extractBalancedJson(input)).toBe('{"path":"C:\\\\Users"}');
  });

  it("returns null when no opening brace", () => {
    expect(extractBalancedJson("no json here")).toBeNull();
  });

  it("returns null when braces never balance", () => {
    expect(extractBalancedJson("{ unclosed")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(extractBalancedJson("")).toBeNull();
  });

  it("extracts first balanced object when multiple exist", () => {
    const input = '{"first":1}{"second":2}';
    expect(extractBalancedJson(input)).toBe('{"first":1}');
  });
});

describe("parseStretchResponse", () => {
  const validResponse = {
    chunks: [
      {
        id: "c0",
        paragraphs: [
          { id: "p0", kernel: "Essential meaning.", context: "Supporting detail." },
          { id: "p1", kernel: "Key point.", context: "More context here." },
        ],
      },
    ],
  };

  it("parses a valid response", () => {
    const result = parseStretchResponse(
      JSON.stringify(validResponse),
      "c0",
      EXPECTED_PARAGRAPHS,
      HTML_BY_ID,
    );
    expect(result.ok).toBe(true);
    expect(result.value).toBeDefined();
    expect(result.value?.id).toBe("c0");
    expect(result.value?.paragraphs.length).toBe(2);
    expect(result.value?.paragraphs[0].kernel).toBe("Essential meaning.");
    expect(result.value?.paragraphs[0].context).toBe("Supporting detail.");
    expect(result.value?.paragraphs[0].full).toBe("First paragraph with some content.");
    expect(result.value?.paragraphs[0].html).toBe("<p>First paragraph with some content.</p>");
  });

  it("strips markdown fences before parsing", () => {
    const fenced = `\`\`\`json\n${JSON.stringify(validResponse)}\n\`\`\``;
    const result = parseStretchResponse(
      fenced,
      "c0",
      EXPECTED_PARAGRAPHS,
      HTML_BY_ID,
    );
    expect(result.ok).toBe(true);
  });

  it("finds JSON object embedded in text", () => {
    const embedded = `Here is the result: ${JSON.stringify(validResponse)} thanks!`;
    const result = parseStretchResponse(
      embedded,
      "c0",
      EXPECTED_PARAGRAPHS,
      HTML_BY_ID,
    );
    expect(result.ok).toBe(true);
  });

  it("returns error for empty response", () => {
    const result = parseStretchResponse("", "c0", EXPECTED_PARAGRAPHS, HTML_BY_ID);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Empty response");
  });

  it("returns error for whitespace-only response", () => {
    const result = parseStretchResponse("   \n\t  ", "c0", EXPECTED_PARAGRAPHS, HTML_BY_ID);
    expect(result.ok).toBe(false);
  });

  it("returns error when no JSON object found", () => {
    const result = parseStretchResponse("No JSON here at all", "c0", EXPECTED_PARAGRAPHS, HTML_BY_ID);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("no JSON object");
  });

  it("returns error for invalid JSON", () => {
    const result = parseStretchResponse("{ invalid json", "c0", EXPECTED_PARAGRAPHS, HTML_BY_ID);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Model response contained no JSON object");
  });

  it("returns error when JSON is not an object", () => {
    const result = parseStretchResponse("[1,2,3]", "c0", EXPECTED_PARAGRAPHS, HTML_BY_ID);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Model response contained no JSON object");
  });

  it("returns error when chunks array is missing", () => {
    const result = parseStretchResponse('{"other": "data"}', "c0", EXPECTED_PARAGRAPHS, HTML_BY_ID);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("missing a 'chunks' array");
  });

  it("returns error when expected chunk id not found", () => {
    const response = { chunks: [{ id: "other", paragraphs: [] }] };
    const result = parseStretchResponse(
      JSON.stringify(response),
      "c0",
      EXPECTED_PARAGRAPHS,
      HTML_BY_ID,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("expected chunk id");
  });

  it("returns error when chunk missing paragraphs array", () => {
    const response = { chunks: [{ id: "c0" }] };
    const result = parseStretchResponse(
      JSON.stringify(response),
      "c0",
      EXPECTED_PARAGRAPHS,
      HTML_BY_ID,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("missing a 'paragraphs' array");
  });

  it("uses fallback when model omits a paragraph", () => {
    const response = {
      chunks: [
        {
          id: "c0",
          paragraphs: [
            { id: "p0", kernel: "Essential", context: "Detail" },
            // p1 missing
          ],
        },
      ],
    };
    const result = parseStretchResponse(
      JSON.stringify(response),
      "c0",
      EXPECTED_PARAGRAPHS,
      HTML_BY_ID,
    );
    expect(result.ok).toBe(true);
    expect(result.value?.paragraphs.length).toBe(2);
    // p0 from model
    expect(result.value?.paragraphs[0].kernel).toBe("Essential");
    // p1 fallback
    expect(result.value?.paragraphs[1].kernel).toBe("Second paragraph continues the thought.");
    expect(result.value?.paragraphs[1].context).toBe("Second paragraph continues the thought.");
    expect(result.value?.paragraphs[1].full).toBe("Second paragraph continues the thought.");
  });

  it("uses fallback when model provides empty kernel and context", () => {
    const response = {
      chunks: [
        {
          id: "c0",
          paragraphs: [
            { id: "p0", kernel: "", context: "" },
            { id: "p1", kernel: "Key", context: "Context" },
          ],
        },
      ],
    };
    const result = parseStretchResponse(
      JSON.stringify(response),
      "c0",
      EXPECTED_PARAGRAPHS,
      HTML_BY_ID,
    );
    expect(result.ok).toBe(true);
    expect(result.value?.paragraphs[0].kernel).toBe("First paragraph with some content.");
    expect(result.value?.paragraphs[0].context).toBe("First paragraph with some content.");
  });

  it("uses fallback when model provides only kernel", () => {
    const response = {
      chunks: [
        {
          id: "c0",
          paragraphs: [
            { id: "p0", kernel: "Just kernel" },
            { id: "p1", kernel: "Key", context: "Context" },
          ],
        },
      ],
    };
    const result = parseStretchResponse(
      JSON.stringify(response),
      "c0",
      EXPECTED_PARAGRAPHS,
      HTML_BY_ID,
    );
    expect(result.ok).toBe(true);
    expect(result.value?.paragraphs[0].kernel).toBe("Just kernel");
    expect(result.value?.paragraphs[0].context).toBe("First paragraph with some content."); // fallback
  });

  it("uses fallback when model provides only context", () => {
    const response = {
      chunks: [
        {
          id: "c0",
          paragraphs: [
            { id: "p0", context: "Just context" },
            { id: "p1", kernel: "Key", context: "Context" },
          ],
        },
      ],
    };
    const result = parseStretchResponse(
      JSON.stringify(response),
      "c0",
      EXPECTED_PARAGRAPHS,
      HTML_BY_ID,
    );
    expect(result.ok).toBe(true);
    expect(result.value?.paragraphs[0].kernel).toBe("First paragraph with some content."); // fallback
    expect(result.value?.paragraphs[0].context).toBe("Just context");
  });

  it("uses custom HTML from cacheHtmlById when available", () => {
    const response = {
      chunks: [
        {
          id: "c0",
          paragraphs: [
            { id: "p0", kernel: "Essential", context: "Detail" },
          ],
        },
      ],
    };
    const customHtml = new Map([["p0", "<p>Custom HTML</p>"]]);
    const result = parseStretchResponse(
      JSON.stringify(response),
      "c0",
      [EXPECTED_PARAGRAPHS[0]],
      customHtml,
    );
    expect(result.ok).toBe(true);
    expect(result.value?.paragraphs[0].html).toBe("<p>Custom HTML</p>");
  });

  it("falls back to original html when cacheHtmlById missing", () => {
    const response = {
      chunks: [
        {
          id: "c0",
          paragraphs: [
            { id: "p0", kernel: "Essential", context: "Detail" },
          ],
        },
      ],
    };
    const result = parseStretchResponse(
      JSON.stringify(response),
      "c0",
      [EXPECTED_PARAGRAPHS[0]],
      new Map(),
    );
    expect(result.ok).toBe(true);
    expect(result.value?.paragraphs[0].html).toBe("<p>First paragraph with some content.</p>");
  });

  it("ignores extra paragraphs from model not in expected list", () => {
    const response = {
      chunks: [
        {
          id: "c0",
          paragraphs: [
            { id: "p0", kernel: "Essential", context: "Detail" },
            { id: "p1", kernel: "Key", context: "Context" },
            { id: "p99", kernel: "Extra", context: "Should be ignored" },
          ],
        },
      ],
    };
    const result = parseStretchResponse(
      JSON.stringify(response),
      "c0",
      EXPECTED_PARAGRAPHS,
      HTML_BY_ID,
    );
    expect(result.ok).toBe(true);
    expect(result.value?.paragraphs.length).toBe(2); // only p0 and p1
  });

  it("ignores extra chunks from model", () => {
    const response = {
      chunks: [
        { id: "c0", paragraphs: [{ id: "p0", kernel: "Essential", context: "Detail" }] },
        { id: "c1", paragraphs: [{ id: "p1", kernel: "Extra chunk", context: "Ignore" }] },
      ],
    };
    const result = parseStretchResponse(
      JSON.stringify(response),
      "c0",
      [EXPECTED_PARAGRAPHS[0]],
      HTML_BY_ID,
    );
    expect(result.ok).toBe(true);
    expect(result.value?.paragraphs.length).toBe(1);
  });

  it("handles long text truncation in fallback", () => {
    const longText = "x".repeat(500);
    const paragraphs = [makeParagraph(longText, "p0")];
    const htmlMap = new Map([["p0", "<p>" + longText + "</p>"]]);
    const response = { chunks: [{ id: "c0", paragraphs: [] }] };
    const result = parseStretchResponse(
      JSON.stringify(response),
      "c0",
      paragraphs,
      htmlMap,
    );
    expect(result.ok).toBe(true);
    // fallback truncates to ~300 chars
    expect(result.value?.paragraphs[0].kernel.length).toBeLessThanOrEqual(300);
    expect(result.value?.paragraphs[0].kernel).toContain("…");
  });

  it("sets generatedAt to a recent timestamp", () => {
    const before = Date.now();
    const result = parseStretchResponse(
      JSON.stringify(validResponse),
      "c0",
      EXPECTED_PARAGRAPHS,
      HTML_BY_ID,
    );
    const after = Date.now();
    expect(result.ok).toBe(true);
    expect(result.value?.generatedAt).toBeGreaterThanOrEqual(before);
    expect(result.value?.generatedAt).toBeLessThanOrEqual(after);
  });

  it("leaves model field empty for caller to fill", () => {
    const result = parseStretchResponse(
      JSON.stringify(validResponse),
      "c0",
      EXPECTED_PARAGRAPHS,
      HTML_BY_ID,
    );
    expect(result.ok).toBe(true);
    expect(result.value?.model).toBe("");
  });
});