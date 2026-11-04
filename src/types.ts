/**
 * Shared contracts for PolliStretch.
 *
 * These types are the single source of truth used by content scripts, the
 * service worker, and the popup. Nothing in here references DOM or browser
 * internals so it can be unit-tested in isolation.
 */

/** A single paragraph extracted from the page, before transformation. */
export interface RawParagraph {
  /** Stable, deterministic identifier for this paragraph within the page. */
  id: string;
  /** Plain-text content (HTML stripped). Used as the transform input. */
  text: string;
  /** Inner HTML of the paragraph, preserved for faithful restoration. */
  html: string;
  /** Approximate character count of `text`. */
  charCount: number;
  /** Optional heading that precedes this paragraph (for context). */
  heading?: string;
}

/** One chunk of paragraphs sent in a single generation request. */
export interface RawChunk {
  id: string;
  paragraphs: RawParagraph[];
  charCount: number;
}

/** The three information levels produced by the engine for one paragraph. */
export interface StretchParagraph {
  id: string;
  kernel: string; // minimum essential meaning
  context: string; // supporting detail / reasoning
  full: string; // exact original text — never generated
  html: string; // exact original HTML — never generated
  heading?: string;
  charCount: number;
}

/** A chunk of transformed paragraphs, as stored in cache. */
export interface StretchChunk {
  id: string;
  paragraphs: StretchParagraph[];
  generatedAt: number;
  model: string;
}

/** A generation request payload for the Pollinations text endpoint. */
export interface GenerateRequest {
  model: string;
  messages: Array<{ role: "system" | "user"; content: string }>;
  max_tokens?: number;
  temperature?: number;
  stream?: false;
}

/** A generation response, after validation. */
export interface GenerateResponse {
  content: string;
  model?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/** Connection state for the Pollinations BYOP flow. */
export type AuthState =
  | "disconnected"
  | "connecting"
  | "authorized"
  | "error";

export interface AuthStatus {
  state: AuthState;
  error?: string;
  /** User info when available (from /api/device/userinfo). */
  user?: { sub?: string; preferred_username?: string; picture?: string };
}

/** Cached stretch representation, keyed by content hash. */
export interface CacheEntry {
  key: string; // hash of (url + chunkId + model)
  chunk: StretchChunk;
  expiresAt: number;
}

/** The reading depth a paragraph is currently displayed at. */
export type DisplayLevel = "kernel" | "context" | "full";

/** A message exchanged between content script, popup, and service worker. */
export type ExtensionMessage =
  | { type: "GET_STATUS" }
  | { type: "ACTIVATE" }
  | { type: "DEACTIVATE" }
  | { type: "RESTORE" }
  | { type: "EXPAND_ALL" }
  | { type: "COLLAPSE_ALL" }
  | { type: "SET_DEPTH", depth: number }
  | { type: "EXPAND_PARAGRAPH", id: string }
  | { type: "COLLAPSE_PARAGRAPH", id: string }
  | { type: "GET_SETTINGS" }
  | { type: "SAVE_SETTINGS", settings: UserSettings }
  | { type: "GET_AUTH" }
  | { type: "CONNECT_POLLINATIONS" }
  | { type: "DISCONNECT_POLLINATIONS" }
  | { type: "CLEAR_CACHE" }
  | { type: "PAGE_READY" }
  | { type: "EXTRACT_CONTENT" }
  | { type: "GENERATE", payload: { chunkId: string; paragraphs: RawParagraph[] } }
  | { type: "CONTENT_ERROR", message: string };

/** User preferences persisted across sessions. */
export interface UserSettings {
  theme: "system" | "light" | "dark";
  defaultDepth: number; // 0..2 (kernel..full)
  autoExpandOnActivate: boolean;
  model: string;
  showWordSavings: boolean;
  shortcutActivate: string;
  cacheTTLHours: number;
  appId?: string; // Pollinations publishable app key (pk_...), for BYOP
}

/** Default settings — used when nothing is stored. */
export const DEFAULT_SETTINGS: UserSettings = {
  theme: "system",
  defaultDepth: 0,
  autoExpandOnActivate: false,
  model: "openai/gpt-5.4-nano",
  showWordSavings: true,
  shortcutActivate: "Alt+Shift+P",
  cacheTTLHours: 168, // 7 days
  appId: "pk_fbE6eIlFn6motVjD",
};

/** A per-page runtime state, kept in the content script. */
export interface PageState {
  url: string;
  title: string;
  active: boolean;
  depth: number; // 0..2
  chunks: Map<string, StretchChunk>;
  originals: Map<string, string>; // paragraph id -> original HTML snapshot
  observer: MutationObserver | null;
}

/** Validation result from the parser. */
export interface ParseResult<T> {
  ok: boolean;
  value?: T;
  error?: string;
}

/** Pollinations API error shape. */
export interface ApiError {
  status: number;
  code?: string;
  message: string;
}