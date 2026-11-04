/**
 * Pollinations text generation client.
 *
 * - Bearer auth via a user-supplied access token (BYOP device flow).
 * - AbortController cancellation.
 * - Retry with exponential backoff for 429/5xx, honoring Retry-After.
 * - Request timeout via an internal AbortController race.
 * - Response validation: non-JSON or missing `choices` -> typed error.
 * - No developer-funded fallback: if the token is missing/invalid, we fail
 *   with a clear "connect your Pollinations account" error.
 */
import type { ApiError, GenerateRequest, GenerateResponse } from "../types";

const BASE = "https://gen.pollinations.ai";

export type FetchLike = typeof fetch;

export interface ClientOptions {
  fetchImpl?: FetchLike;
  /** Injected by the service worker; returns the current user access token. */
  getToken?: () => Promise<string | null>;
  /** Default model; falls back to the caller's `request.model` if set. */
  defaultModel?: string;
  /** Per-request timeout in ms. Default 60_000. */
  timeoutMs?: number;
  /** Max retry attempts (initial + retries). Default 4. */
  maxRetries?: number;
  /** Base delay for exponential backoff, ms. Default 500. */
  retryBaseMs?: number;
  signal?: AbortSignal;
}

export class PollinationsError extends Error {
  constructor(
    public readonly apiError: ApiError,
    message: string
  ) {
    super(message);
    this.name = "PollinationsError";
  }
}

export interface PollinationsClient {
  generate(req: GenerateRequest, opts?: { signal?: AbortSignal }): Promise<GenerateResponse>;
  listModels(): Promise<unknown>;
}

export function createPollinationsClient(opts: ClientOptions = {}): PollinationsClient {
  const {
    fetchImpl = fetch,
    getToken,
    defaultModel = "openai/gpt-5.4-nano",
    timeoutMs = 60_000,
    maxRetries = 4,
    retryBaseMs = 500,
    signal,
  } = opts;

  const sleep = (ms: number, sig?: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, ms);
      sig?.addEventListener("abort", () => {
        clearTimeout(t);
        reject(new DOMException("Aborted", "AbortError"));
      }, { once: true });
    });

  const isRetryable = (status: number) =>
    status === 429 || status >= 500;

  async function request<T>(
    path: string,
    init: RequestInit,
    onToken?: (token: string) => void,
    signal?: AbortSignal,
  ): Promise<T> {
    const doFetch = async (attempt: number, externalSignal?: AbortSignal): Promise<Response> => {
      // Race the fetch against a per-request timeout
      const ac = new AbortController();
      const onAbort = () => ac.abort();
      externalSignal?.addEventListener("abort", onAbort, { once: true });
      const timer = setTimeout(() => ac.abort(), timeoutMs);

      try {
        let headers = new Headers(init.headers);
        if (onToken && getToken) {
          const token = await getToken();
          if (!token) {
            throw new PollinationsError(
              { status: 401, code: "no_token", message: "No Pollinations account connected" },
              "Connect your Pollinations account to generate content."
            );
          }
          headers.set("Authorization", `Bearer ${token}`);
          onToken(token);
        }
        return await fetchImpl(
          path.startsWith("http") ? path : `${BASE}${path}`,
          { ...init, headers, signal: ac.signal },
        );
      } finally {
        clearTimeout(timer);
        externalSignal?.removeEventListener("abort", onAbort);
      }
    };

    let lastError: ApiError | undefined;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      let res: Response;
      try {
        res = await doFetch(attempt, signal);
      } catch (err) {
        if ((err as Error)?.name === "AbortError") {
          throw new PollinationsError(
            { status: 0, code: "timeout_or_aborted", message: "Request timed out or was cancelled" },
            "Request did not complete in time. Try again."
          );
        }
        throw err;
      }

      if (res.ok) {
        const ct = res.headers.get("content-type") ?? "";
        if (!ct.includes("application/json")) {
          const text = await res.text().catch(() => "");
          throw new PollinationsError(
            { status: res.status, code: "bad_content_type", message: `Expected JSON, got ${ct || "unknown"}` },
            "Server did not return a JSON response."
          );
        }
        return (await res.json()) as T;
      }

      let body: any;
      try { body = await res.json(); } catch { body = { message: await res.text().catch(() => "") }; }
      lastError = {
        status: res.status,
        code: body?.error?.code ?? body?.code ?? undefined,
        message: body?.error?.message ?? body?.message ?? `HTTP ${res.status}`,
      };

      if (!isRetryable(res.status)) {
        const friendly =
          res.status === 402 ? "Insufficient Pollen balance — top up at enter.pollinations.ai." :
          res.status === 401 ? "Authorization failed — reconnect your Pollinations account." :
          res.status === 403 ? "Access denied — your key may lack permission for this model." :
          lastError.message;
        throw new PollinationsError(lastError, friendly);
      }

      // 429 / 5xx: honor Retry-After if present, else exponential backoff
      const retryAfter = res.headers.get("retry-after");
      const delayMs = retryAfter
        ? Math.min(30_000, Number(retryAfter) * 1000)
        : Math.min(8000, retryBaseMs * 2 ** attempt);
      if (attempt === maxRetries - 1) break;
      await sleep(delayMs, signal);
    }

    throw new PollinationsError(
      lastError ?? { status: 0, code: "network", message: "Network request failed" },
      lastError?.message ?? "Generation request failed after retries."
    );
  }

  return {
    async generate(req, genOpts) {
      const model = req.model || defaultModel;
      const payload: GenerateRequest = { ...req, model };
      const init: RequestInit = {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model,
          messages: payload.messages,
          temperature: payload.temperature ?? 0.2,
          max_tokens: payload.max_tokens ?? 2048,
          stream: false,
        }),
      };
      const data = await request<{
        choices?: Array<{ message?: { content?: string } }>;
      }>("/v1/chat/completions", init, () => {}, genOpts?.signal ?? signal);

      const content = data?.choices?.[0]?.message?.content;
      if (typeof content !== "string" || content.length === 0) {
        throw new PollinationsError(
          { status: 200, code: "empty_completion", message: "Model returned an empty completion" },
          "The model returned no content. Try again or pick a different model."
        );
      }
      return { content } satisfies GenerateResponse;
    },

    async listModels() {
      return request<Array<unknown>>("/text/models", { method: "GET" });
    },
  };
}
