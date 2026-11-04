import React, { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ArrowLeft, ArrowUpRight, BookOpen, Check, ChevronDown, ChevronUp, CircleHelp, LoaderCircle, RotateCcw, Settings as SettingsIcon, Shrink, Sparkles, Unplug } from "lucide-react";
import type { UserSettings } from "../types";
import { DEFAULT_SETTINGS } from "../types";

type View = "reader" | "settings";
type PageState = { title?: string; url?: string; active?: boolean; depth?: number; transformed?: boolean; status?: string };
type AuthInfo = { connected: boolean; user?: { preferred_username?: string; picture?: string } | null };
type DeviceCode = { user_code?: string; verification_uri_complete?: string };
type Reply<T> = { ok: true; result: T } | { ok: false; error?: string };

const DEPTHS = [
  { key: "kernel", label: "Kernel", hint: "The essentials", depth: 0 },
  { key: "context", label: "Context", hint: "Meaning + detail", depth: 1 },
  { key: "full", label: "Full text", hint: "Original article", depth: 2 },
] as const;

function responseValue<T>(reply: unknown): T {
  if (reply && typeof reply === "object" && "ok" in reply) {
    const result = reply as Reply<T>;
    if (!result.ok) throw new Error(result.error || "The extension could not complete that request.");
    return result.result;
  }
  return reply as T;
}

function sendRuntime<T>(message: Record<string, unknown>): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (reply: unknown) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) { reject(new Error(lastError.message || "Extension service is unavailable.")); return; }
      try { resolve(responseValue<T>(reply)); } catch (error) { reject(error); }
    });
  });
}

function sendPage<T>(tabId: number, message: Record<string, unknown>): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (reply: unknown) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) { reject(new Error("PolliStretch isn’t available on this page. Try a regular webpage and refresh it.")); return; }
      try { resolve(responseValue<T>(reply)); } catch (error) { reject(error); }
    });
  });
}

function App() {
  const [view, setView] = useState<View>("reader");
  const [tabId, setTabId] = useState<number | null>(null);
  const [page, setPage] = useState<PageState>({});
  const [pageKnown, setPageKnown] = useState(false);
  const [pageError, setPageError] = useState("");
  const [busy, setBusy] = useState("");
  const [auth, setAuth] = useState<AuthInfo>({ connected: false });
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");
  const [progress, setProgress] = useState("");
  const [deviceCode, setDeviceCode] = useState<DeviceCode | null>(null);
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [settingsReady, setSettingsReady] = useState(false);
  const [settingsNote, setSettingsNote] = useState("");

  const refreshPage = useCallback(async (id: number) => {
    setPageError("");
    try {
      let state: PageState;
      try {
        state = await sendPage<PageState>(id, { type: "GET_PAGE_STATE" });
      } catch {
        // Older content-script builds expose GET_STATUS instead.
        state = await sendPage<PageState>(id, { type: "GET_STATUS" });
      }
      setPage((previous) => ({ ...previous, ...(state || {}), title: state?.title || previous.title, url: state?.url || previous.url }));
      setPageKnown(true);
    } catch (error) {
      setPage({});
      setPageKnown(false);
      setPageError(error instanceof Error ? error.message : "Page state is unavailable.");
    }
  }, []);

  const refreshAuth = useCallback(async () => {
    try { setAuth(responseValue<AuthInfo>(await sendRuntime({ type: "GET_AUTH" })) || { connected: false }); }
    catch (error) { setAuthError(error instanceof Error ? error.message : "Could not check account status."); }
  }, []);

  useEffect(() => {
    let alive = true;
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!alive) return;
      const tab = tabs[0];
      setTabId(typeof tab?.id === "number" ? tab.id : null);
      setPage({ title: tab?.title || "A quieter way to read", url: tab?.url });
      if (typeof tab?.id === "number") void refreshPage(tab.id);
      else setPageError("No active browser tab was found.");
    });
    sendRuntime<UserSettings>({ type: "GET_SETTINGS" }).then((saved) => {
      if (!alive) return;
      const loaded = { ...DEFAULT_SETTINGS, ...(saved || {}) };
      setSettings(loaded);
      document.documentElement.dataset.theme = loaded.theme === "system" ? "" : loaded.theme;
      setSettingsReady(true);
    }).catch((error: unknown) => {
      if (!alive) return;
      setSettingsReady(true);
      setPageError(error instanceof Error ? error.message : "Could not load preferences.");
    });
    void refreshAuth();
    const listener = (message: Record<string, unknown>) => {
      if (message.type === "DEVICE_CODE") {
        const code = message.code as DeviceCode | undefined;
        setDeviceCode(code || null);
        setAuthBusy(true);
        setProgress("Open the secure Pollinations page to approve this device.");
        if (code?.verification_uri_complete) chrome.tabs.create({ url: code.verification_uri_complete, active: false });
      } else if (message.type === "AUTH_PROGRESS") {
        setProgress(String(message.status || "Connecting securely…"));
      } else if (message.type === "AUTH_STATUS") {
        const status = String(message.status || "");
        const descriptions: Record<string, string> = { pending: "Waiting for approval…", slow_down: "Taking a moment before checking again…", network_error: "Network hiccup — retrying…", authorized: "Approved. Finishing connection…", expired: "This code expired. Start again for a new one.", denied: "Authorization was declined." };
        setProgress(descriptions[status] || String(message.detail || status));
        if (status === "expired" || status === "denied") { setAuthBusy(false); setDeviceCode(null); }
      } else if (message.type === "AUTH_CONNECTED") {
        setAuth({ connected: true, user: message.user as AuthInfo["user"] });
        setAuthBusy(false); setDeviceCode(null); setProgress("Your Pollinations account is connected."); setAuthError("");
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => { alive = false; chrome.runtime.onMessage.removeListener(listener); };
  }, [refreshAuth, refreshPage]);

  useEffect(() => {
    if (!settingsReady) return;
    const timer = window.setTimeout(() => {
      sendRuntime({ type: "SAVE_SETTINGS", settings }).then(() => setSettingsNote("Saved")).catch((error: unknown) => setSettingsNote(error instanceof Error ? error.message : "Could not save."));
    }, 220);
    return () => window.clearTimeout(timer);
  }, [settings, settingsReady]);

  const doPageAction = async (type: string, extra: Record<string, unknown> = {}) => {
    if (tabId === null) return;
    setBusy(type); setPageError("");
    try {
      const result = await sendPage<{ ok?: boolean; message?: string }>(tabId, { type, ...extra });
      if (result?.ok === false) throw new Error(result.message || "The page could not complete that action.");
      // For SET_DEPTH, refreshPage below will report the real depth from the
      // content script's pageStateSnapshot; no need to patch it locally here.
      await refreshPage(tabId);
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Could not control the current page.");
    } finally { setBusy(""); }
  };

  const connect = async () => {
    setAuthBusy(true); setAuthError(""); setProgress("Requesting a secure sign-in code…"); setDeviceCode(null);
    try { await sendRuntime({ type: "CONNECT_POLLINATIONS" }); await refreshAuth(); setAuthBusy(false); }
    catch (error) {
      setAuthBusy(false); setDeviceCode(null);
      setAuthError(error instanceof Error ? error.message : "Could not connect to Pollinations.");
    }
  };

  const disconnect = async () => {
    setAuthBusy(true); setAuthError("");
    try { await sendRuntime({ type: "DISCONNECT_POLLINATIONS" }); setAuth({ connected: false }); setProgress("Disconnected."); }
    catch (error) { setAuthError(error instanceof Error ? error.message : "Could not disconnect."); }
    finally { setAuthBusy(false); }
  };

  const save = (updates: Partial<UserSettings>) => setSettings((current) => ({ ...current, ...updates }));
  const title = page.title || "A quieter way to read";
  const hostname = (() => { try { return page.url ? new URL(page.url).hostname : "PolliStretch reading tool"; } catch { return "PolliStretch reading tool"; } })();
  const selectedDepth = page.depth ?? settings.defaultDepth;
  const active = Boolean(page.active);

  return <main className="popup">
    <header className="masthead">
      <div className="brand"><span className="mark" aria-hidden="true">p</span><span className="brand-name">PolliStretch</span></div>
      <span className="edition">A reading instrument</span>
    </header>

    {view === "reader" ? <>
      <section className="page" aria-label="Current page">
        <div className="eyebrow"><span>On this page</span><span className={`status${active ? " active" : ""}`}>{active ? "Stretching" : "Original"}</span></div>
        <h1 title={title}>{title}</h1>
        <div className="host">{hostname}</div>
      </section>
      <hr className="rule" />
      <section aria-label="Reading level">
        <div className="section-label">Choose your reading depth</div>
        <div className="depths">
          {DEPTHS.map((depth) => <button type="button" key={depth.key} aria-pressed={selectedDepth === depth.depth} className={`depth${selectedDepth === depth.depth ? " selected" : ""}`} onClick={() => active ? void doPageAction("SET_DEPTH", { depth: depth.depth }) : save({ defaultDepth: depth.depth })} disabled={Boolean(busy) || !settingsReady}>
            <b>{depth.label}</b><small>{depth.hint}</small>
          </button>)}
        </div>
        <div className="actions">
          {!active ? <button type="button" className="btn primary" onClick={() => void doPageAction("ACTIVATE")} disabled={!pageKnown || Boolean(busy)}>
            {busy === "ACTIVATE" ? <><LoaderCircle size={14} className="spinner" /> Preparing page…</> : <><Sparkles size={14} /> Stretch this page</>}
          </button> : <>
            <button type="button" className="btn" onClick={() => void doPageAction("EXPAND_ALL")} disabled={Boolean(busy)}><ChevronDown size={14} /> Expand all</button>
            <button type="button" className="btn" onClick={() => void doPageAction("COLLAPSE_ALL")} disabled={Boolean(busy)}><ChevronUp size={14} /> Collapse all</button>
            <button type="button" className="btn" onClick={() => void doPageAction("RESTORE")} disabled={Boolean(busy)}><RotateCcw size={14} /> Restore original</button>
            <button type="button" className="btn danger" onClick={() => void doPageAction("DEACTIVATE")} disabled={Boolean(busy)}><Shrink size={14} /> Hide controls</button>
          </>}
        </div>
        {pageError && <div className="error" role="alert">{pageError}</div>}
        {!pageKnown && !pageError && <div className="auth-progress">Checking whether this page can be transformed…</div>}
      </section>
      <aside className="notice"><BookOpen size={14} aria-hidden="true" /><span>To make a shorter reading, selected article text is sent to Pollinations. Your personal token is sent only to Pollinations.</span></aside>
      <footer className="footer">
        <div className={`account${auth.connected ? " connected" : ""}`}><span className="dot" />{auth.connected ? auth.user?.preferred_username || "Pollen connected" : "Pollen not connected"}</div>
        <button type="button" className="icon-btn" aria-label="Settings" title="Settings" onClick={() => setView("settings")}><SettingsIcon size={16} /></button>
      </footer>
    </> : <>
      <div className="settings-head"><button type="button" className="back-btn" aria-label="Back" onClick={() => setView("reader")}><ArrowLeft size={15} /></button><h2>Preferences</h2></div>
      <section className="setting">
        <div className="setting-head"><label htmlFor="theme">Appearance</label></div>
        <p>Choose how PolliStretch looks.</p>
        <select id="theme" value={settings.theme} onChange={(event) => { save({ theme: event.target.value as UserSettings["theme"] }); document.documentElement.dataset.theme = event.target.value === "system" ? "" : event.target.value; }}>
          <option value="system">System</option><option value="light">Light paper</option><option value="dark">Dark ink</option>
        </select>
      </section>
      <section className="setting">
        <div className="setting-head"><label htmlFor="default-depth">Starting depth</label></div>
        <p>The reading level used when a page is first stretched.</p>
        <select id="default-depth" value={settings.defaultDepth} onChange={(event) => save({ defaultDepth: Number(event.target.value) })}>
          {DEPTHS.map((depth) => <option key={depth.depth} value={depth.depth}>{depth.label}</option>)}
        </select>
      </section>
      <section className="setting">
        <div className="setting-head"><label htmlFor="app-id">Pollinations App Key</label></div>
        <p>Create a publishable app key at <a href="https://enter.pollinations.ai/keys" target="_blank" rel="noreferrer">enter.pollinations.ai/keys</a> → Apps → Create. This key identifies PolliStretch on the consent screen.</p>
        <input id="app-id" value={settings.appId ?? ""} onChange={(event) => save({ appId: event.target.value.trim() })} spellCheck={false} autoComplete="off" placeholder="pk_…" />
      </section>
      <section className="setting">
        <div className="setting-head"><label htmlFor="model">Generation model</label></div>
        <p>Model used by Pollinations to prepare shorter versions.</p>
        <input id="model" value={settings.model} onChange={(event) => save({ model: event.target.value.trim() })} spellCheck={false} autoComplete="off" />
      </section>
      <section className="setting">
        <div className="setting-head"><label>Local reading cache</label></div>
        <p>Remove saved generated text from this browser.</p>
        <button type="button" className="btn" style={{ marginTop: 9 }} onClick={() => { setSettingsNote("Clearing…"); sendRuntime({ type: "CLEAR_CACHE" }).then(() => setSettingsNote("Reading cache cleared.")).catch((error: unknown) => setSettingsNote(error instanceof Error ? error.message : "Could not clear cache.")); }}><Unplug size={14} /> Clear cache</button>
      </section>
      <section className="setting">
        <div className="setting-head"><label>Data &amp; privacy</label><CircleHelp size={14} color="var(--muted)" /></div>
        <p>Article text selected for stretching is sent to Pollinations for generation. The Pollinations access token is sent only to Pollinations to authorize requests. Generated text may be stored in the local reading cache until cleared.</p>
      </section>
      <section className="setting">
        <div className="setting-head"><label>Pollinations account</label>{auth.connected && <span className="account connected"><span className="dot" />Connected</span>}</div>
        {auth.connected ? <div className="auth-card">
          {auth.user?.picture && <div className="auth-user"><img src={auth.user.picture} alt="" />{auth.user.preferred_username || "Pollinations account"}</div>}
          {!auth.user?.picture && <p>{auth.user?.preferred_username || "Your account is connected."}</p>}
          <button type="button" className="btn danger" onClick={() => void disconnect()} disabled={authBusy}>{authBusy ? "Disconnecting…" : "Disconnect"}</button>
        </div> : <div className="auth-card">
          <h3>Bring your own Pollen</h3><p>Connect your Pollinations account to authorize generation with your own access.</p>
          {deviceCode?.user_code && <><div className="device-code" aria-label={`Your device code is ${deviceCode.user_code}`}>{deviceCode.user_code}</div><p>Select the code above to copy it manually, then enter it on the Pollinations page opened in a new tab.</p></>}
          <button type="button" className="btn primary" onClick={() => void connect()} disabled={authBusy}>{authBusy ? <><LoaderCircle size={14} className="spinner" /> Waiting for approval…</> : <><ArrowUpRight size={14} /> Connect Pollinations</>}</button>
          {progress && <div className="auth-progress" aria-live="polite">{progress}</div>}
        </div>}
        {authError && <div className="error" role="alert">{authError}</div>}
      </section>
      {settingsNote && <div className="auth-progress" role="status">{settingsNote}</div>}
      <footer className="footer"><div className="account">{settingsReady ? "Preferences save automatically" : "Loading preferences…"}</div><button type="button" className="icon-btn" aria-label="Back to reader" onClick={() => setView("reader")}><Check size={16} /></button></footer>
    </>}
  </main>;
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);
