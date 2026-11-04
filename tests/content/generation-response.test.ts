import { describe, expect, it } from "vitest";
import { requireGeneratedChunks } from "../../src/content/generation-response";
import type { StretchChunk } from "../../src/types";

describe("requireGeneratedChunks", () => {
  it("accepts the chunk array returned after the message envelope is unwrapped", () => {
    const chunks = [{ id: "c0", paragraphs: [], generatedAt: 1, model: "test" }] satisfies StretchChunk[];

    expect(requireGeneratedChunks(chunks)).toBe(chunks);
  });

  it("rejects an invalid generation result with a useful error", () => {
    expect(() => requireGeneratedChunks({ ok: true, result: [] })).toThrow(
      "Service worker returned invalid data for GENERATE."
    );
  });
});
