/** MV3 service worker: device auth, model generation, cache, settings, message routing. */
import type { ExtensionMessage, UserSettings, RawParagraph, StretchChunk } from "../types";
import { DEFAULT_SETTINGS } from "../types";
import { createDeviceFlow } from "../api/device";
import { createPollinationsClient } from "../api/pollinations";
import { chunkParagraphs, } from "../lib/chunk";
import { parseStretchResponse } from "../lib/parser";
import { buildStretchPrompt } from "../lib/prompt";
import { createIdbCache } from "../lib/cache";
import { hashChunk } from "../lib/extract";

const TOKEN_KEY = "pollinationsAccessToken";
const USER_KEY = "pollinationsUser";
const SETTINGS_KEY = "settings";
const cache = createIdbCache();

async function getToken(): Promise<string | null> {
  const stored = await chrome.storage.session.get(TOKEN_KEY);
  return typeof stored[TOKEN_KEY] === "string" ? stored[TOKEN_KEY] : null;
}

const api = createPollinationsClient({
  getToken,
  timeoutMs: 60_000,
  maxRetries: 3,
});

async function getSettings(): Promise<UserSettings> {
  const { [SETTINGS_KEY]: s } = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(s && typeof s === "object" ? s : {}) };
}

async function saveSettings(settings: UserSettings): Promise<void> {
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
}

/** Generate/cache all supplied paragraphs, preserving original full text and HTML. */
async function generateFor(paragraphs: RawParagraph[]): Promise<StretchChunk[]> {
  const settings = await getSettings();
  const groups = chunkParagraphs(paragraphs, 6000);
  const chunks: StretchChunk[] = [];
  for (const group of groups) {
    const key = hashChunk(settings.model, group.paragraphs);
    const cached = await cache.get(key);
    if (cached) {
      chunks.push(cached.chunk);
      continue;
    }
    const prompt = buildStretchPrompt(group);
    const result = await api.generate({
      model: settings.model,
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user },
      ],
      max_tokens: Math.min(4000, Math.max(500, group.paragraphs.length * 250)),
      temperature: 0.2,
    });
    const html = new Map(group.paragraphs.map((p) => [p.id, p.html]));
    const parsed = parseStretchResponse(result.content, group.id, group.paragraphs, html);
    if (!parsed.ok || !parsed.value) {
      // Fail safely and visibly. Do NOT present a fake generated summary.
      throw new Error(parsed.error ?? "Could not parse the model response.");
    }
    const chunk: StretchChunk = { ...parsed.value, model: settings.model };
    const ttl = settings.cacheTTLHours * 60 * 60 * 1000;
    await cache.set({ key, chunk, expiresAt: Date.now() + ttl });
    chunks.push(chunk);
  }
  return chunks;
}

/** Open auth flow in popup; device code and progress are broadcast to popup clients. */
let authAbort: AbortController | null = null;
async function connectPollinations(): Promise<void> {
  const settings = await getSettings();
  const clientId = settings.appId?.trim();
  if (!clientId) {
    throw new Error("Add your Pollinations App Key in Settings first. Create one at enter.pollinations.ai/keys → Apps → Create.");
  }
  if (!/^pk_[A-Za-z0-9_-]+$/.test(clientId)) {
    throw new Error("The App Key should start with pk_. Check your key at enter.pollinations.ai/keys.");
  }
  authAbort?.abort();
  authAbort = new AbortController();
  const flow = createDeviceFlow({
    clientId,
    events: {
      onProgress: (status) => {
        chrome.runtime.sendMessage({ type: "AUTH_PROGRESS", status }).catch(() => {});
      },
    },
  });
  await chrome.storage.local.set({ [USER_KEY]: null });
  const code = await flow.requestCode();
  await chrome.storage.session.set({ deviceCode: code.device_code });
  chrome.runtime.sendMessage({ type: "DEVICE_CODE", code }).catch(() => {});
  const token = await flow.pollForToken(code.device_code, {
    intervalSec: code.interval,
    expiresSec: code.expires_in,
    signal: authAbort.signal,
    onStatus: (status, detail) => {
      chrome.runtime.sendMessage({ type: "AUTH_STATUS", status, detail }).catch(() => {});
    },
  });
  // Only store token in session storage (not local), never log it.
  await chrome.storage.session.set({ [TOKEN_KEY]: token.access_token });
  await chrome.storage.session.remove("deviceCode");
  const user = await flow.fetchUserInfo(token.access_token);
  await chrome.storage.local.set({ [USER_KEY]: user });
  chrome.runtime.sendMessage({ type: "AUTH_CONNECTED", user }).catch(() => {});
}

async function disconnectPollinations(): Promise<void> {
  authAbort?.abort();
  await chrome.storage.session.remove([TOKEN_KEY, "deviceCode"]);
  await chrome.storage.local.remove(USER_KEY);
}

async function handleMessage(
  message: ExtensionMessage | { type: string; [key: string]: unknown },
  sender: chrome.runtime.MessageSender,
): Promise<unknown> {
  switch (message.type) {
    case "GET_STATUS": {
      const tab = sender.tab;
      const auth = await getToken();
      return { connected: !!auth, tabId: tab?.id };
    }
    case "GET_SETTINGS":
      return getSettings();
    case "SAVE_SETTINGS":
      if ("settings" in message && message.settings) await saveSettings(message.settings as UserSettings);
      return { ok: true };
    case "GET_AUTH": {
      const token = await getToken();
      const { [USER_KEY]: user } = await chrome.storage.local.get(USER_KEY);
      return { connected: !!token, user: user ?? null };
    }
    case "CONNECT_POLLINATIONS":
      await connectPollinations();
      return { ok: true };
    case "DISCONNECT_POLLINATIONS":
      await disconnectPollinations();
      return { ok: true };
    case "GENERATE": {
      if (!("payload" in message) || !message.payload || !Array.isArray((message.payload as any).paragraphs)) {
        throw new Error("Invalid generation request.");
      }
      const paragraphs = (message.payload as { paragraphs: RawParagraph[] }).paragraphs;
      if (paragraphs.length === 0) return [];
      return generateFor(paragraphs);
    }
    case "CLEAR_CACHE":
      await cache.clear();
      return { ok: true };
    default:
      return undefined;
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Messages are internal Chrome extension messages; no page-world bridge.
  handleMessage(message as ExtensionMessage, sender)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((err: unknown) => {
      const error = err instanceof Error ? err.message : "An unexpected error occurred.";
      sendResponse({ ok: false, error });
    });
  return true; // async response
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "activate") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url || /^(chrome|edge|about|chrome-extension):/.test(tab.url)) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "ACTIVATE" });
  } catch {
    // Content script may not have run yet (e.g., a newly opened tab). Inject it.
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content/index.js"] }).catch(() => {});
  }
});
