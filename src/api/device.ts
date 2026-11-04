/**
 * BYOP — Bring Your Own Pollen — device authorization flow.
 *
 * Official spec (pollinations/pollinations BRING_YOUR_OWN_POLLEN.md):
 *
 *   1. POST https://enter.pollinations.ai/api/device/code
 *        { "client_id": "<pk_... publishable app key>" }
 *      -> { device_code, user_code, verification_uri,
 *            verification_uri_complete, expires_in, interval }
 *
 *   2. User opens verification_uri_complete and authorizes in their browser.
 *
 *   3. Poll POST https://enter.pollinations.ai/api/device/token
 *        { "device_code": "<device_code>" }
 *      -> 200 { access_token, token_type }   on success
 *         -> 400 { error: "authorization_pending" } while user has not authorized
 *         -> 400 { error: "slow_down" }      poll less frequently (back off)
 *         -> 400 { error: "expired_token" }  device code lapsed (user took too long)
 *         -> 403 { error: "access_denied" }  user refused
 *
 * Security rules we enforce:
 *   - The access token is only ever stored by the caller (chrome.storage.session
 *     in the SW), never logged, never embedded in URLs.
 *   - No developer-funded fallback: if the flow fails, we surface a clear error.
 *   - `fetchImpl` and timers are injectable for tests.
 */

export const DEVICE_CODE_URL = "https://enter.pollinations.ai/api/device/code";
export const DEVICE_TOKEN_URL = "https://enter.pollinations.ai/api/device/token";
export const DEVICE_USERINFO_URL = "https://enter.pollinations.ai/api/device/userinfo";

/** App key identifier for the device flow. Not a secret — identifies the app in consent. */
export const PUBLISHABLE_APP_KEY = "pk_fbE6eIlFn6motVjD";

export type DeviceCodeStatus =
  | "authorized"
  | "pending"
  | "slow_down"
  | "expired"
  | "denied"
  | "network_error";

export interface DeviceCodeResult {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

export interface DeviceTokenResult {
  access_token: string;
  token_type: string;
}

export interface DeviceFlowEvents {
  onPending?: () => void;
  onProgress?: (info: string) => void;
}

export interface DeviceFlow {
  /** Step 1 — exchange client_id for a device/user code. */
  requestCode(): Promise<DeviceCodeResult>;
  /** Step 3 — poll for the user's authorization. Resolves on success, rejects on expired/denied. */
  pollForToken(
    deviceCode: string,
    opts?: {
      intervalSec?: number;
      expiresSec?: number;
      onStatus?: (s: DeviceCodeStatus, detail?: string) => void;
      signal?: AbortSignal;
    },
  ): Promise<DeviceTokenResult>;
  /** Fetch the user's account info with the freshly obtained token. */
  fetchUserInfo(token: string): Promise<{ sub?: string; preferred_username?: string; picture?: string }>;
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface DeviceFlowOptions {
  fetchImpl?: FetchLike;
  clientId?: string;
  /** Injectable sleep so tests don't wait real time. Default: setTimeout. */
  sleepImpl?: (ms: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
  events?: DeviceFlowEvents;
}

export function createDeviceFlow(opts: DeviceFlowOptions = {}): DeviceFlow {
  const {
    fetchImpl = fetch as unknown as FetchLike,
    clientId = PUBLISHABLE_APP_KEY,
    sleepImpl = defaultSleep,
    now = () => Date.now(),
    events = {},
  } = opts;

  function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(resolve, ms);
      signal?.addEventListener("abort", () => {
        clearTimeout(t);
        reject(new DOMException("Aborted", "AbortError"));
      }, { once: true });
    });
  }

  async function postJson(url: string, body: unknown): Promise<{ ok: boolean; status: number; data: any; headers: Headers }> {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    let data: any = null;
    try { data = await res.json(); } catch { /* body may be empty */ }
    return { ok: res.ok, status: res.status, data, headers: res.headers };
  }

  return {
    async requestCode() {
      const { ok, status, data } = await postJson(DEVICE_CODE_URL, { client_id: clientId });
      if (!ok || !data?.device_code) {
        throw new Error(
          `Device code request failed (HTTP ${status}). ` +
          "Check your connection and try again."
        );
      }
      events.onProgress?.("Device code requested — open the link to authorize.");
      return data as DeviceCodeResult;
    },

    async pollForToken(deviceCode, p = {}) {
      const intervalSec = p.intervalSec ?? 5;
      const expiresSec = p.expiresSec ?? 1800;
      const start = now();
      const deadline = start + expiresSec * 1000;
      let slowDownUntil = 0;

      while (true) {
        if (now() > deadline) {
          p.onStatus?.("expired");
          throw new Error("Device code expired before authorization completed.");
        }
        if (p.signal?.aborted) {
          p.onStatus?.("network_error", "Aborted");
          throw new DOMException("Aborted", "AbortError");
        }

        // Respect slow_down: wait out the quiet window before the next poll
        if (now() < slowDownUntil) {
          const waitMs = slowDownUntil - now();
          await sleepImpl(Math.min(waitMs, 2000), p.signal);
          continue;
        }

        let status: DeviceCodeStatus = "pending";
        let tokenData: DeviceTokenResult | null = null;
        let detail: string | undefined;

        try {
          const { ok, data, headers } = await postJson(DEVICE_TOKEN_URL, { device_code: deviceCode });
          if (ok && data?.access_token) {
            status = "authorized";
            tokenData = data as DeviceTokenResult;
          } else {
            const errCode = data?.error;
            switch (errCode) {
              case "authorization_pending":
                status = "pending";
                break;
              case "slow_down":
                status = "slow_down";
                {
                  const retryAfter = Number(headers.get("retry-after") ?? "10");
                  slowDownUntil = now() + retryAfter * 1000;
                }
                break;
              case "expired_token":
                status = "expired";
                break;
              case "access_denied":
              case "authorization_request_denied":
                status = "denied";
                break;
              default:
                status = "pending"; // unknown error codes: keep polling
                detail = errCode ? `server reported "${errCode}"` : undefined;
            }
          }
        } catch {
          status = "network_error";
        }

        p.onStatus?.(status, detail);
        if (events.onProgress) events.onProgress(statusLabel(status, detail));

        if (status === "authorized" && tokenData) return tokenData;
        if (status === "expired" || status === "denied") {
          throw new Error(
            status === "denied"
              ? "Authorization was declined. You can try again."
              : "The authorization window closed before completing. Request a new code."
          );
        }

        // network_error: brief backoff, then keep polling until deadline
        await sleepImpl((status === "network_error" ? 2 : intervalSec) * 1000, p.signal);
      }
    },

    async fetchUserInfo(token) {
      const res = await fetchImpl(DEVICE_USERINFO_URL, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return {};
      try {
        const j = (await res.json()) as Record<string, unknown>;
        return {
          sub: typeof j.sub === "string" ? j.sub : undefined,
          preferred_username: typeof j.preferred_username === "string" ? j.preferred_username : undefined,
          picture: typeof j.picture === "string" ? j.picture : undefined,
        };
      } catch {
        return {};
      }
    },
  };
}

function statusLabel(s: DeviceCodeStatus, detail?: string): string {
  switch (s) {
    case "authorized": return "Authorized — connecting…";
    case "pending": return "Waiting for you to authorize…";
    case "slow_down": return "Backing off (server asked for a slower poll)…";
    case "expired": return "Code expired.";
    case "denied": return "Authorization declined.";
    case "network_error": return detail ? `Network hiccup: ${detail}` : "Network hiccup — retrying…";
  }
}
