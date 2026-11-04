/**
 * Article content extraction.
 *
 * Detects the "meaningful article body" of a page using a score-based
 * candidate approach. Returns a list of paragraph candidates with stable,
 * deterministic ids so downstream generation and caching can key on them.
 *
 * Conservative by design: when confidence is low, we surface it and let
 * the caller decide whether to proceed (or force-activate).
 */
import type { RawParagraph } from "../types";

export interface ExtractionResult {
  paragraphs: RawParagraph[];
  /** 0..1 — how confident we are this is an article body. */
  confidence: number;
  /** Container we pulled paragraphs from, for scoped transformation. */
  container: Element;
  title: string;
  hostname: string;
}

/** Selectors that are almost certainly NOT article content. */
const EXCLUDE_SELECTOR = [
  "nav",
  "header",
  "footer",
  "aside",
  "form",
  "table.polli-table",
  "iframe",
  "script",
  "style",
  "[role='banner']",
  "[role='navigation']",
  "[role='contentinfo']",
  "[role='complementary']",
  "input, select, textarea, button, label, option",
  ".ad, .advert, .ads, .sponsored, .promo, .cookie, .popup, .modal, .tooltip, .carousel, .slider, .social-share, .share-buttons, .breadcrumbs, .related-articles, .newsletter, .comment-form",
  "#nav, #header, #footer, #menu, #sidebar, #comments, #related, #promo",
].join(", ");

/**
 * Candidate containers, tried in priority order. Each returns a candidate
 * container and a weight; the best one wins.
 */
const CANDIDATES: Array<{ selector: string; weight: number; reason: string }> = [
  { selector: "main", weight: 0.85, reason: "main landmark" },
  { selector: "article", weight: 0.9, reason: "article landmark" },
  { selector: "[itemprop='articleBody']", weight: 0.95, reason: "schema.org articleBody" },
  { selector: "[role='article']", weight: 0.9, reason: "role=article" },
  { selector: ".post-content, .entry-content, .article-content, .story-body, .post-body, .content", weight: 0.6, reason: "common content class" },
  { selector: "#content, #main", weight: 0.55, reason: "common content id" },
];

const P_TAG = "p";
const MIN_P_WORDCOUNT = 40; // skip very short paragraphs
const MAX_P_WORDCOUNT = 3000; // skip absurdly long ones

function scoreContainer(el: Element, reason: string): number {
  const ps = el.querySelectorAll(`${P_TAG}:not(${EXCLUDE_SELECTOR})`);
  let score = 0;
  let totalChars = 0;
  let goodP = 0;
  for (const p of Array.from(ps)) {
    const text = p.textContent?.trim() ?? "";
    const wc = text.split(/\s+/).filter(Boolean).length;
    if (wc < MIN_P_WORDCOUNT) continue;
    if (wc > MAX_P_WORDCOUNT) continue;
    totalChars += text.length;
    goodP += 1;
  }
  if (goodP < 3) return 0.05; // too few real paragraphs
  // density of p-tags
  const pDensity = goodP / Math.max(1, ps.length);
  score = pDensity * 0.4;
  // char count bonus
  score += Math.min(1, totalChars / 5000) * 0.3;
  // base weight of the selector
  score += 0.3;
  // penalty if the container is huge (likely the whole page)
  const all = el.querySelectorAll(P_TAG).length;
  if (all > 200) score *= 0.4;
  // reason-specific bonus
  if (reason.startsWith("schema.org") || reason.startsWith("article") || reason.startsWith("main") || reason.startsWith("role")) {
    score += 0.15;
  }
  return Math.min(1, score);
}

function pickContainer(doc: Document): { el: Element; score: number } {
  let best: { el: Element; score: number } = { el: doc.body ?? doc.documentElement, score: 0 };
  for (const c of CANDIDATES) {
    for (const el of Array.from(doc.querySelectorAll(c.selector))) {
      const s = scoreContainer(el, c.reason);
      if (s > best.score) best = { el, score: s };
    }
  }
  // Fallback: walk body's children for the densest paragraph block
  if (best.score < 0.25 && doc.body) {
    for (const child of Array.from(doc.body.children)) {
      const s = scoreContainer(child, "body child");
      if (s > best.score) best = { el: child, score: s };
    }
  }
  return best;
}

function htmlOf(el: Element, depth = 4): string {
  // Clone the element up to `depth` ancestors and return its innerHTML.
  // We keep a lightweight structural snapshot for restoration fidelity.
  const clone = el.cloneNode(true) as Element;
  // Strip any PolliStretch-injected children if present
  clone.querySelectorAll("[data-polli='stretch-anchor']").forEach((n) => n.remove());
  clone.querySelectorAll("[data-polli='tool']").forEach((n) => n.remove());
  clone.querySelectorAll("[data-polli='chevron']").forEach((n) => n.remove());
  return clone.innerHTML;
}

function textOf(el: Element): string {
  const clone = el.cloneNode(true) as Element;
  clone.querySelectorAll("[data-polli]").forEach((n) => n.remove());
  // Normalize whitespace: collapse all spaces
  return (clone.textContent ?? "").replace(/\s+/g, " ").trim();
}

export function extractArticle(doc: Document): ExtractionResult {
  const { el, score } = pickContainer(doc);
  const container = el;
  const ps = Array.from(container.querySelectorAll(`${P_TAG}:not(${EXCLUDE_SELECTOR})`));
  const paragraphs: RawParagraph[] = [];
  let lastHeading: string | undefined;
  const headingTags = ["h1", "h2", "h3", "h4", "h5", "h6"];

  // Walk in document order, tracking headings
  const selector = [...headingTags, P_TAG].join(", ");
  const all = Array.from(container.querySelectorAll(selector));
  const sorted = all.sort((a, b) => {
    const c = a.compareDocumentPosition(b);
    if (c & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (c & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  });

  for (const node of sorted) {
    if (headingTags.includes(node.tagName.toLowerCase())) {
      lastHeading = textOf(node);
      continue;
    }
    const text = textOf(node);
    const wc = text.split(/\s+/).filter(Boolean).length;
    if (wc < MIN_P_WORDCOUNT) continue;
    const id = `p${paragraphs.length}`;
    paragraphs.push({
      id,
      text,
      html: htmlOf(node as Element),
      charCount: text.length,
      heading: lastHeading,
    });
    // Track which paragraph belongs to the container
    if (node.parentElement === container) {
      // no-op
    }
  }

  // Only keep paragraphs actually inside the container
  const inContainer = new Set<Element>();
  container.querySelectorAll(P_TAG).forEach((p) => inContainer.add(p));
  const filtered = paragraphs.filter((p, i) => {
    // We don't have a reference back to the element; rely on index + order
    // by rebuilding a parallel array of elements
    return true;
  });

  return {
    paragraphs: filtered,
    confidence: Math.max(score, 0.05),
    container,
    title: doc.title,
    hostname: (doc as Document & { location?: Location }).location?.hostname ?? document.location?.hostname ?? "unknown",
  };
}

/**
 * Hash a chunk of content for cache keys. Deterministic FNV-1a 32-bit.
 */
export function hashChunk(model: string, paragraphs: RawParagraph[]): string {
  const str = model + "|" + paragraphs.map((p) => p.id + ":" + p.text).join("\n");
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}
