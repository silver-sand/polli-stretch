/**
 * Chunking: group paragraphs into generation-sized requests.
 *
 * A chunk never splits a paragraph (a paragraph is the smallest unit the
 * engine can transform), and never spans a heading change — keeping each
 * request inside one section improves both prompt quality and cache hits.
 */

import type { RawChunk, RawParagraph } from "../types";

export const DEFAULT_MAX_CHARS = 6000;

export function chunkParagraphs(
  paragraphs: RawParagraph[],
  maxChars: number = DEFAULT_MAX_CHARS,
): RawChunk[] {
  const chunks: RawChunk[] = [];
  let current: RawParagraph[] = [];
  let currentChars = 0;
  let currentHeading: string | undefined;

  const flush = () => {
    if (current.length === 0) return;
    chunks.push({
      id: `c${chunks.length}`,
      // Copy paragraphs so caller mutation of the result does not affect the input
      paragraphs: current.map((p) => ({ ...p })),
      charCount: currentChars,
    });
    current = [];
    currentChars = 0;
  };

  for (const paragraph of paragraphs) {
    const size = paragraph.charCount || paragraph.text.length;
    const headingChanged =
      current.length > 0 && paragraph.heading !== currentHeading;
    const overBudget = current.length > 0 && currentChars + size > maxChars;

    if (headingChanged || overBudget) flush();

    if (current.length === 0) currentHeading = paragraph.heading;
    current.push(paragraph);
    currentChars += size;
  }

  flush();
  return chunks;
}
