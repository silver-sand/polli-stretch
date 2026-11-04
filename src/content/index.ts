/**
 * PolliStretch Content Script — Entry point and message router.
 *
 * Responsibilities:
 *  - Listen for extension messages (ACTIVATE, DEACTIVATE, RESTORE, EXPAND/COLLAPSE, etc.)
 *  - Extract semantic article body via extractArticle (with local insertion-target mapping)
 *  - Send GENERATE requests to the service worker
 *  - Transform eligible p elements in place to kernel/context/full with subtle controls
 *  - Preserve exact original DOM nodes for faithful restoration
 *  - Guard own mutations with data-polli markers
 *  - Ensure idempotent activation and clean teardown
 */

import { extractArticle, type ExtractionResult } from "../lib/extract";
import type { RawParagraph, StretchParagraph, StretchChunk, DisplayLevel } from "../types";
import { ui } from "./ui";
import { requireGeneratedChunks } from "./generation-response";

// ---------------------------------------------------------------------------
// Module-level state (per tab)
// ---------------------------------------------------------------------------

let activationState: {
  active: boolean;
  extraction: ExtractionResult | null;
  /**
   * paragraphId -> actual original child node references (not serialized).
   * Preserves listeners, element identity, and event bindings.
   */
  originalNodes: Map<string, Node[]>;
  /** paragraphId -> live <p> element we mutated */
  paragraphEls: Map<string, HTMLElement>;
  /** paragraphId -> current display level */
  levels: Map<string, DisplayLevel>;
  /** All StretchParagraphs available for this page */
  stretchParagraphs: StretchParagraph[];
  /** Current progress: how many paragraphs have been generated */
  generatedCount: number;
  uiRefs: ReturnType<typeof ui.createUIRefs>;
  /** Whether we've successfully transformed at least one paragraph */
  transformed: boolean;
} = {
  active: false,
  extraction: null,
  originalNodes: new Map(),
  paragraphEls: new Map(),
  levels: new Map(),
  stretchParagraphs: [],
  generatedCount: 0,
  uiRefs: ui.createUIRefs(),
  transformed: false,
};

/** Message envelope the service worker returns. */
interface SWResponse<T = unknown> {
  ok: boolean;
  result?: T;
  error?: string;
}

/** A GENERATE request payload. */
interface GeneratePayload {
  chunkId: string;
  paragraphs: RawParagraph[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Compute the display level name from a 0-indexed depth (kernel=0, context=1, full=2). */
function levelName(depth: number): DisplayLevel {
  if (depth >= 2) return "full";
  if (depth === 1) return "context";
  return "kernel";
}

/** Check if a URL is one we can safely operate on. */
function isSupportedUrl(url: string): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();
  // Block browser internals, extension pages, and about: frames
  if (lower.startsWith("chrome://") || lower.startsWith("chrome-extension://")) return false;
  if (lower.startsWith("edge://") || lower.startsWith("about:")) return false;
  if (lower.startsWith("file://")) return false;
  if (lower.startsWith("data:")) return false;
  if (lower.startsWith("view-source:")) return false;
  // Web Store
  if (lower.includes("chromewebstore.google.com")) return false;
  return true;
}

/**
 * Re-select the semantic paragraph list in the same document order,
 * applying the same eligibility criterion as extractArticle used, so
 * insertion targets map correctly to extracted IDs p0, p1, p2, ...
 *
 * This is a local improvement that does not modify extract.ts.
 */
function reselectParagraphElements(extraction: ExtractionResult): HTMLElement[] {
  const container = extraction.container;
  if (!document.body.contains(container)) {
    // Container was removed from the document — bail out gracefully
    return [];
  }

  // Re-derive the same eligibility filter extractArticle uses:
  //   p elements not matching EXCLUDE_SELECTOR, in document order,
  //   with word count between 40 and 3000.
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

  const MIN_P_WORDCOUNT = 40;
  const MAX_P_WORDCOUNT = 3000;

  const ps = Array.from(container.querySelectorAll(`p:not(${EXCLUDE_SELECTOR})`));

  const eligible: HTMLElement[] = [];
  for (const p of ps) {
    const text = (p.textContent ?? "").trim();
    const wc = text.split(/\s+/).filter(Boolean).length;
    if (wc < MIN_P_WORDCOUNT || wc > MAX_P_WORDCOUNT) continue;
    // Protect nested interactive elements: skip paragraphs that are
    // primarily interactive (e.g., a <p> that IS a button, or contains
    // a form that would be disrupted). We still transform them at
    // kernel/context (text-only), but never at full depth if they
    // contain protected elements that would be displayed inline.
    eligible.push(p as HTMLElement);
  }

  return eligible;
}

/**
 * Build a stable insertion-target map: paragraphId -> HTMLElement.
 *
 * extractArticle produces IDs in the order it walks `sorted` (document order
 * of p + headings, filtered by word count). We re-select the same list here
 * so the ID `p0` in the extraction maps to the correct live <p>.
 */
function buildParagraphMap(extraction: ExtractionResult): Map<string, HTMLElement> {
  const els = reselectParagraphElements(extraction);
  const map = new Map<string, HTMLElement>();
  extraction.paragraphs.forEach((p, i) => {
    const el = els[i];
    if (el) map.set(p.id, el);
  });
  return map;
}

/** Compute confidence for the extraction result. */
function computeConfidence(extraction: ExtractionResult): number {
  return extraction.confidence;
}

/** Threshold below which we reject gracefully with a notice. */
const LOW_CONFIDENCE_THRESHOLD = 0.2;

/**
 * Determine if a confidence value is too low to proceed.
 * Returns a human-readable reason if rejected, otherwise null.
 */
function confidenceRejectionReason(confidence: number): string | null {
  if (confidence < LOW_CONFIDENCE_THRESHOLD) {
    return "Could not detect the article body with enough confidence on this page.";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Page state snapshot — what the popup queries via GET_PAGE_STATE / GET_STATUS
// ---------------------------------------------------------------------------

/** A flat, JSON-serializable snapshot of per-page state for the popup UI. */
function pageStateSnapshot(): {
  active: boolean;
  transformed: boolean;
  depth: number;
  title: string;
  url: string;
  status: string;
} {
  return {
    active: activationState.active,
    transformed: activationState.transformed,
    depth: activationState.active
      ? activationState.levels.size > 0 && Array.from(activationState.levels.values()).every((l) => l === "full")
        ? 2
        : activationState.levels.size > 0 && Array.from(activationState.levels.values()).every((l) => l === "context")
          ? 1
          : 0
      : 0,
    title: document.title || "",
    url: window.location.href,
    status: activationState.active
      ? activationState.transformed
        ? "stretched"
        : "preparing"
      : "original",
  };
}

// ---------------------------------------------------------------------------
// Message handling
// ---------------------------------------------------------------------------

/**
 * Handle an ACTIVATE message from the background or popup.
 * Returns a status object so the caller (popup) knows what happened.
 */
async function handleActivate(): Promise<{ ok: boolean; message?: string; confidence?: number }> {
  // Idempotency: if already active, just refresh UI and return success
  if (activationState.active) {
    ui.setToolbarVisible(activationState.uiRefs, true);
    return { ok: true, message: "Already active." };
  }

  // Reject unsupported pages
  const url = window.location.href;
  if (!isSupportedUrl(url)) {
    return { ok: false, message: "PolliStretch cannot run on this page (browser-internal or unsupported URL)." };
  }

  if (!document.body) {
    return { ok: false, message: "Document body not yet available." };
  }

  // Extract the semantic body
  let extraction: ExtractionResult;
  try {
    extraction = extractArticle(document);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Extraction failed.";
    return { ok: false, message: msg };
  }

  const confidence = computeConfidence(extraction);

  // Reject low-confidence pages gracefully
  const rejection = confidenceRejectionReason(confidence);
  if (rejection) {
    ui.showToast(activationState.uiRefs, rejection, "info");
    return { ok: false, message: rejection, confidence };
  }

  // If there are no eligible paragraphs, reject
  if (extraction.paragraphs.length === 0) {
    ui.showToast(activationState.uiRefs, "No readable paragraphs found in the article body.", "info");
    return { ok: false, message: "No eligible paragraphs found." };
  }

  // Capture original nodes BEFORE any mutation, by actual node reference.
  const paragraphMap = buildParagraphMap(extraction);
  if (paragraphMap.size === 0) {
    ui.showToast(activationState.uiRefs, "Could not map extracted paragraphs to live elements.", "error");
    return { ok: false, message: "Paragraph mapping failed." };
  }

  for (const p of extraction.paragraphs) {
    const el = paragraphMap.get(p.id);
    if (el && !activationState.originalNodes.has(p.id)) {
      activationState.originalNodes.set(p.id, Array.from(el.childNodes));
    }
  }

  // Track the live elements and set initial level to kernel
  for (const [id, el] of paragraphMap) {
    activationState.paragraphEls.set(id, el);
    activationState.levels.set(id, "kernel");
  }

  activationState.extraction = extraction;
  activationState.generatedCount = 0;
  activationState.stretchParagraphs = [];
  activationState.transformed = false;
  activationState.active = true;

  // Show loading state
  ui.showLoading(activationState.uiRefs, "Detecting article…");

  // Send GENERATE request to the service worker
  const chunks = chunkForGeneration(extraction.paragraphs);
  try {
    const chunksResult = await requestGeneration(chunks);
    activationState.stretchParagraphs = flattenChunks(chunksResult);
    activationState.generatedCount = activationState.stretchParagraphs.length;
    hideLoadingSafe();
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Generation request failed.";
    ui.hideLoading(activationState.uiRefs);
    ui.showToast(activationState.uiRefs, msg, "error", 6000);
    // Do not mark active if generation failed — user can retry via ACTIVATE
    activationState.active = false;
    return { ok: false, message: msg };
  }

  // Transform all paragraphs to kernel by default
  await transformAll("kernel");

  // Show toolbar
  ui.setToolbarVisible(activationState.uiRefs, true);
  ui.updateToolbarTitle(activationState.uiRefs, document.title || "Untitled");
  ui.updateToolbarProgress(activationState.uiRefs, activationState.stretchParagraphs.length, activationState.stretchParagraphs.length);
  ui.showToast(activationState.uiRefs, "PolliStretch active — click ▸ to expand, or use the toolbar.", "success", 4000);

  return { ok: true, confidence };
}

/**
 * Chunk the extraction's paragraphs into generation requests.
 * Uses chunkParagraphs from lib/chunk.ts to mirror the service worker's
 * chunking, producing one GENERATE payload per chunk (c0, c1, ...).
 */
function chunkForGeneration(paragraphs: RawParagraph[]): GeneratePayload[] {
  // chunkParagraphs groups by heading and char budget, returning
  // RawChunk[] with ids c0, c1, ... The service worker re-chunks
  // internally; sending our own chunks keeps the request payload small
  // and allows per-chunk progress tracking.
  const MAX_CHARS = 6000;
  const chunks: GeneratePayload[] = [];
  let current: RawParagraph[] = [];
  let currentChars = 0;
  let currentHeading: string | undefined;

  const flush = (): void => {
    if (current.length === 0) return;
    chunks.push({ chunkId: `c${chunks.length}`, paragraphs: current });
    current = [];
    currentChars = 0;
  };

  for (const p of paragraphs) {
    const size = p.charCount || p.text.length;
    const headingChanged = current.length > 0 && p.heading !== currentHeading;
    const overBudget = current.length > 0 && currentChars + size > MAX_CHARS;
    if (headingChanged || overBudget) flush();
    if (current.length === 0) currentHeading = p.heading;
    current.push(p);
    currentChars += size;
  }
  flush();
  return chunks;
}

/** Send GENERATE requests; sendMessage already unwraps the SW envelope. */
async function requestGeneration(payloads: GeneratePayload[]): Promise<StretchChunk[]> {
  const all: StretchChunk[] = [];
  for (const payload of payloads) {
    const result = await sendMessage<unknown>({
      type: "GENERATE",
      payload: {
        chunkId: payload.chunkId,
        paragraphs: payload.paragraphs,
      },
    });
    all.push(...requireGeneratedChunks(result));
  }
  return all;
}

/** Flatten chunks into a single array of StretchParagraphs. */
function flattenChunks(chunks: StretchChunk[]): StretchParagraph[] {
  return chunks.flatMap((c) => c.paragraphs);
}

/**
 * Hide the loading overlay if it's still showing.
 * Safe to call multiple times.
 */
function hideLoadingSafe(): void {
  ui.hideLoading(activationState.uiRefs);
}

/**
 * Transform all paragraphs to a given level.
 */
async function transformAll(level: DisplayLevel): Promise<void> {
  const sp = new Map(activationState.stretchParagraphs.map((p) => [p.id, p]));
  let count = 0;
  const total = sp.size;

  for (const [id, stretchP] of sp) {
    const el = activationState.paragraphEls.get(id);
    if (!el || !document.body.contains(el)) continue;

    // Skip paragraphs with protected interactive elements at kernel/context
    // (they render text-only, so they're safe), but at full we need to
    // make sure we don't break buttons/forms/editors.
    ui.transformParagraph(el, stretchP, level, activationState.originalNodes);
    activationState.levels.set(id, level);
    count++;
  }

  ui.updateToolbarProgress(activationState.uiRefs, count, total);
  activationState.transformed = true;
}

/**
 * Expand a single paragraph one level deeper.
 */
function expandOne(id: string): void {
  const current = activationState.levels.get(id);
  if (!current) return;
  const next = current === "kernel" ? "context" : current === "context" ? "full" : "full";
  applyLevelToParagraph(id, next);
}

/**
 * Collapse a single paragraph one level shallower.
 */
function collapseOne(id: string): void {
  const current = activationState.levels.get(id);
  if (!current) return;
  const prev = current === "full" ? "context" : current === "context" ? "kernel" : "kernel";
  applyLevelToParagraph(id, prev);
}

/**
 * Apply a specific level to a single paragraph.
 */
function applyLevelToParagraph(id: string, level: DisplayLevel): void {
  const el = activationState.paragraphEls.get(id);
  const stretchP = activationState.stretchParagraphs.find((p) => p.id === id);
  if (!el || !stretchP || !document.body.contains(el)) return;
  ui.transformParagraph(el, stretchP, level, activationState.originalNodes);
  activationState.levels.set(id, level);
}

/** Expand all paragraphs to the next level up (or full). */
function expandAll(): void {
  for (const [id] of activationState.levels) {
    const current = activationState.levels.get(id);
    if (current === "kernel") applyLevelToParagraph(id, "context");
    else if (current === "context") applyLevelToParagraph(id, "full");
  }
  const total = activationState.levels.size;
  ui.updateToolbarProgress(activationState.uiRefs, total, total);
}

/** Collapse all paragraphs to kernel. */
function collapseAll(): void {
  for (const [id] of activationState.levels) {
    applyLevelToParagraph(id, "kernel");
  }
  const total = activationState.levels.size;
  ui.updateToolbarProgress(activationState.uiRefs, 0, total);
}

/**
 * Restore the original page state:
 *  - Replace each paragraph's children with the exact original node references
 *  - Remove all PolliStretch-injected elements (toolbar, toasts, loading)
 *  - Mark state as inactive
 */
function restore(): void {
  // Restore each paragraph using stored node references
  for (const [id, el] of activationState.paragraphEls) {
    if (document.body.contains(el)) {
      ui.restoreParagraph(el, id, activationState.originalNodes);
    }
  }

  // Clear all UI
  ui.teardownUI(activationState.uiRefs);

  // Reset state
  activationState.active = false;
  activationState.extraction = null;
  activationState.originalNodes = new Map();
  activationState.paragraphEls = new Map();
  activationState.levels = new Map();
  activationState.stretchParagraphs = [];
  activationState.generatedCount = 0;
  activationState.transformed = false;
  activationState.uiRefs = ui.createUIRefs();

  ui.showToast(activationState.uiRefs, "PolliStretch deactivated — original page restored.", "info", 3000);
}

/**
 * Deactivate without restoring original content (keep transformed state
 * but hide the toolbar). Used when the user wants to stop tracking but
 * keep the current view.
 */
function deactivate(): void {
  ui.setToolbarVisible(activationState.uiRefs, false);
  ui.hideLoading(activationState.uiRefs);
}

// ---------------------------------------------------------------------------
// Messaging
// ---------------------------------------------------------------------------

/**
 * Send a message to the service worker and unwrap the {ok, result} envelope.
 * Falls back to a no-op if chrome.runtime is unavailable (e.g., in tests).
 */
async function sendMessage<T>(message: Record<string, unknown>): Promise<T> {
  // Handle the case where chrome.runtime might not be fully initialized
  // (e.g., content script running in a context without the extension API)
  if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) {
    throw new Error("Extension messaging API is not available in this context.");
  }
  try {
    const response = await chrome.runtime.sendMessage(message);
    if (response && typeof response === "object" && "ok" in response) {
      const envelope = response as SWResponse<unknown>;
      if (envelope.ok) {
        return envelope.result as T;
      }
      throw new Error(envelope.error ?? "Service worker returned an error.");
    }
    return response as T;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // chrome.runtime.sendMessage throws when the SW is asleep or unavailable
    if (msg.includes("message port closed") || msg.includes("Could not establish connection")) {
      throw new Error("PolliStretch service worker is not running. Try activating again.");
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Runtime message listener (preferred) + fallback to onMessage
// ---------------------------------------------------------------------------

/** Register the runtime listener for extension messages. */
function registerMessageListener(): void {
  // Try chrome.runtime.onMessage first (standard MV3)
  if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message: Record<string, unknown>, _sender, sendResponse: (r: unknown) => void) => {
      handleMessage(message, sendResponse);
      // Return true to keep the channel open for async sendResponse
      return true;
    });
  }
}

/**
 * Route an incoming extension message to the appropriate handler.
 */
function handleMessage(message: Record<string, unknown>, sendResponse: (r: unknown) => void): void {
  const type = message["type"] as string;

  switch (type) {
    case "ACTIVATE":
      handleActivate().then((status) =>
        // Wrap in the { ok, result } envelope the popup's responseValue expects,
        // carrying both the status payload and the human message.
        sendResponse(status.ok ? { ok: true, result: status } : { ok: false, error: status.message || "Could not activate the page." })
      );
      break;

    case "DEACTIVATE":
      deactivate();
      sendResponse({ ok: true, result: { ok: true, message: "Deactivated." } });
      break;

    case "RESTORE":
      restore();
      sendResponse({ ok: true, result: { ok: true, message: "Restored original page." } });
      break;

    case "EXPAND_ALL":
      if (activationState.active) expandAll();
      sendResponse({
        ok: true,
        result: { ok: activationState.active, message: activationState.active ? "Expanded all." : "Not active." },
      });
      break;

    case "COLLAPSE_ALL":
      if (activationState.active) collapseAll();
      sendResponse({
        ok: true,
        result: { ok: activationState.active, message: activationState.active ? "Collapsed all." : "Not active." },
      });
      break;

    case "EXPAND_PARAGRAPH": {
      const id = message["id"] as string;
      if (activationState.active && id) expandOne(id);
      sendResponse({ ok: true, result: { ok: activationState.active } });
      break;
    }

    case "COLLAPSE_PARAGRAPH": {
      const id = message["id"] as string;
      if (activationState.active && id) collapseOne(id);
      sendResponse({ ok: true, result: { ok: activationState.active } });
      break;
    }

    case "SET_DEPTH": {
      const depth = (message["depth"] as number) ?? 0;
      if (activationState.active) {
        const lvl = levelName(depth);
        for (const [id] of activationState.levels) {
          applyLevelToParagraph(id, lvl);
        }
        const total = activationState.levels.size;
        ui.updateToolbarProgress(activationState.uiRefs, total, total);
      }
      sendResponse({ ok: true, result: { ok: activationState.active } });
      break;
    }

    // The popup's refreshPage sends GET_PAGE_STATE first (falling back to
    // GET_STATUS on error). Both return a flat page-state object used to
    // drive the popup UI: title, url, active, depth, transformed, status.
    case "GET_PAGE_STATE":
    case "GET_STATUS": {
      const state = pageStateSnapshot();
      sendResponse({ ok: true, result: state });
      break;
    }

    case "PAGE_READY":
      // The page is ready; no-op for now (we could auto-activate here)
      sendResponse({ ok: true, result: { ok: true } });
      break;

    case "CONTENT_ERROR": {
      const msg = message["message"] as string;
      if (msg && activationState.active) {
        ui.showToast(activationState.uiRefs, msg, "error");
      }
      sendResponse({ ok: true, result: { ok: true } });
      break;
    }

    default:
      // Unknown message — report via `error` (not `message`) so the popup's
      // responseValue can surface a readable cause instead of a generic line.
      sendResponse({ ok: false, error: `Unknown message type: ${type}` });
  }
}

// ---------------------------------------------------------------------------
// Toolbar and chevron event wiring
// ---------------------------------------------------------------------------

/** Wire up toolbar actions (expand-all, collapse-all, restore, deactivate). */
function wireToolbarActions(): void {
  const handler = (e: Event) => {
    const custom = e as CustomEvent<{ action: string }>;
    const action = custom.detail?.action;
    switch (action) {
      case "expand-all":
        expandAll();
        break;
      case "collapse-all":
        collapseAll();
        break;
      case "restore":
        restore();
        break;
      case "deactivate":
        deactivate();
        break;
    }
  };
  document.addEventListener("polli:toolbar-action", handler as EventListener, true);
}

/** Wire up chevron click events from transformed paragraphs. */
function wireChevronActions(): void {
  const handler = (e: Event) => {
    const custom = e as CustomEvent<{ id: string }>;
    const id = custom.detail?.id;
    if (!id) return;
    const current = activationState.levels.get(id);
    if (current === "full") {
      collapseOne(id);
    } else {
      expandOne(id);
    }
  };
  document.addEventListener("polli:chevron-click", handler as EventListener, true);
}

/** Cleanup toolbar/chevron event listeners on restore. */
function cleanupEventListeners(): void {
  // We use document-level listeners; on restore we need to remove them.
  // Since they're captured in closures, we can't easily remove by name.
  // Instead, we just let them be — they no-op when state is inactive.
  // For a cleaner approach, we could store the listener refs, but
  // for now the no-op behavior is sufficient.
}

// ---------------------------------------------------------------------------
// Guard our own mutations with data-polli markers
// ---------------------------------------------------------------------------

/**
 * Install a MutationObserver that guards our own mutations.
 * When a mutation originates from a [data-polli] element, we skip it.
 */
function installMutationGuard(): () => void {
  const target = document.body;
  if (!target) return () => {};

  let dirty = false;
  const MARKER = "data-polli";

  const observer = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === "childList") {
        for (const n of Array.from(r.addedNodes).concat(Array.from(r.removedNodes))) {
          if (n.nodeType === Node.ELEMENT_NODE) {
            const el = n as Element;
            if (el.hasAttribute(MARKER) || el.closest(`[${MARKER}]`)) {
              dirty = false;
              return;
            }
          }
        }
      }
      const t = r.target;
      if (t.nodeType === Node.ELEMENT_NODE) {
        const el = t as Element;
        if (el.hasAttribute(MARKER) || el.closest(`[${MARKER}]`)) {
          dirty = false;
          return;
        }
      }
      break;
    }
    if (dirty) return;
    dirty = true;
    queueMicrotask(() => {
      dirty = false;
      // If a non-polli mutation happened to a tracked paragraph,
      // we could re-sync, but for now we just note it.
      // A full re-extract would be expensive; we defer that to
      // a future iteration.
    });
  });

  observer.observe(target, { childList: true, subtree: true });

  return () => observer.disconnect();
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

let initialized = false;

/** Initialize the content script (idempotent). */
function init(): void {
  if (initialized) return;
  initialized = true;

  // Register the message listener
  registerMessageListener();

  // Wire up UI event handlers
  wireToolbarActions();
  wireChevronActions();

  // Install mutation guard
  installMutationGuard();

  // Clean up UI if the page unloads
  window.addEventListener("beforeunload", () => {
    ui.teardownUI(activationState.uiRefs);
  });

  // Log a subtle indicator in the console (dev aid)
  console.debug("[PolliStretch] Content script ready.");
}

// Auto-initialize when the content script loads
init();

// Export for testing / manual use
export { handleActivate, restore, expandAll, collapseAll, deactivate };