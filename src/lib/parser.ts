/**
 * Parse and validate a stretchtext generation response.
 *
 * The model is unreliable, so this parser is defensive:
 *  - strips markdown fences
 *  - finds the first balanced JSON object via a bracket-matching scanner
 *  - validates the shape and expected ids
 *  - falls back to safe defaults for any missing paragraph
 *  - never throws — always returns a ParseResult
 */

import type {
  RawParagraph,
  StretchChunk,
  StretchParagraph,
  ParseResult,
} from "../types";

/** Strip markdown code fences from a string. */
export function stripFences(raw: string): string {
  const m = raw.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/);
  return m ? m[1] : raw;
}

/** Balanced-bracket scanner: returns the outermost JSON object substring, or null. */
export function extractBalancedJson(raw: string): string | null {
  const start = raw.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  let end = -1;

  for (let i = start; i < raw.length; i++) {
    const c = raw[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (c === "\\") {
      escaped = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }

  return end === -1 ? null : raw.slice(start, end + 1);
}

interface RawModelParagraph {
  id?: string;
  kernel?: string;
  context?: string;
}

interface RawModelChunk {
  id?: string;
  paragraphs?: RawModelParagraph[];
}

interface RawModelResponse {
  chunks?: RawModelChunk[];
}

function isString(v: unknown): v is string {
  return typeof v === "string";
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Safe fallback for a paragraph the model failed to describe. */
function fallbackParagraph(
  p: RawParagraph,
  html: string,
): StretchParagraph {
  const text = p.text;
  return {
    id: p.id,
    kernel: text.length > 300 ? text.slice(0, 297) + "…" : text,
    context: text,
    full: text,
    html,
    heading: p.heading,
    charCount: p.charCount,
  };
}

export function parseStretchResponse(
  raw: string,
  expectedChunkId: string,
  expectedParagraphs: RawParagraph[],
  cacheHtmlById: Map<string, string>,
): ParseResult<StretchChunk> {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return { ok: false, error: "Empty response from model." };
  }

  const cleaned = stripFences(raw);
  const jsonStr = extractBalancedJson(cleaned);
  if (!jsonStr) {
    return { ok: false, error: "Model response contained no JSON object." };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    return { ok: false, error: `Model response was not valid JSON: ${(e as Error).message}` };
  }

  if (!isObject(parsed)) {
    return { ok: false, error: "Model response was not a JSON object." };
  }

  const data = parsed as RawModelResponse;
  if (!Array.isArray(data.chunks)) {
    return { ok: false, error: "Model response is missing a 'chunks' array." };
  }

  // Find the chunk matching the expected id (the model may emit extra chunks).
  const chunkEntry = data.chunks.find(
    (c) => isObject(c) && c.id === expectedChunkId,
  );
  if (!chunkEntry || !isObject(chunkEntry)) {
    return {
      ok: false,
      error: `Model response did not include the expected chunk id "${expectedChunkId}".`,
    };
  }

  if (!Array.isArray(chunkEntry.paragraphs)) {
    return { ok: false, error: "Model chunk is missing a 'paragraphs' array." };
  }

  // Index the model's paragraphs by id; ignore ids we didn't ask for.
  const byId = new Map<string, RawModelParagraph>();
  for (const mp of chunkEntry.paragraphs) {
    if (isObject(mp) && isString(mp.id)) byId.set(mp.id, mp);
  }

  const paragraphs: StretchParagraph[] = [];
  for (const expected of expectedParagraphs) {
    const mp = byId.get(expected.id);
    const html = cacheHtmlById.get(expected.id) ?? expected.html;
    if (!mp) {
      paragraphs.push(fallbackParagraph(expected, html));
      continue;
    }
    const kernel = isString(mp.kernel) ? mp.kernel : "";
    const context = isString(mp.context) ? mp.context : "";
    if (!kernel && !context) {
      paragraphs.push(fallbackParagraph(expected, html));
      continue;
    }
    paragraphs.push({
      id: expected.id,
      kernel: kernel || expected.text,
      context: context || expected.text,
      full: expected.text,
      html,
      heading: expected.heading,
      charCount: expected.charCount,
    });
  }

  return {
    ok: true,
    value: {
      id: expectedChunkId,
      paragraphs,
      generatedAt: Date.now(),
      model: "", // filled in by the caller
    },
  };
}