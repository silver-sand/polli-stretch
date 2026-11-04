import { describe, it, expect, vi } from "vitest";
import { createPollinationsClient, PollinationsError } from "../../src/api/pollinations";

describe("createPollinationsClient", () => {
  it("attaches the user's Bearer token to generation requests", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) =>
      new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    const getToken = vi.fn().mockResolvedValue("sk_test_token");

    const client = createPollinationsClient({ fetchImpl, getToken });
    await client.generate({ model: "openai/gpt-5.4-nano", messages: [{ role: "user", content: "hi" }] });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe("Bearer sk_test_token");
    expect(getToken).toHaveBeenCalled();
  });

  it("fails fast with a clear message when no token is available", async () => {
    const fetchImpl = vi.fn();
    const client = createPollinationsClient({ fetchImpl, getToken: () => Promise.resolve(null) });

    await expect(
      client.generate({ model: "openai/gpt-5.4-nano", messages: [{ role: "user", content: "hi" }] })
    ).rejects.toThrow(/Connect your Pollinations account/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not send a token for unauthenticated requests (listModels)", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify([]), { status: 200, headers: { "content-type": "application/json" } })
    );
    const getToken = vi.fn().mockResolvedValue("sk_test_token");
    const client = createPollinationsClient({ fetchImpl, getToken });

    await client.listModels();
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBeNull();
    expect(getToken).not.toHaveBeenCalled();
  });

  it("surfaces a 401 as the reconnect message, not a generic one", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ error: { message: "bad token" } }), {
        status: 401,
        headers: { "content-type": "application/json" },
      })
    );
    const client = createPollinationsClient({
      fetchImpl,
      getToken: () => Promise.resolve("sk_stale"),
      maxRetries: 1,
    });

    const err = await client
      .generate({ model: "openai/gpt-5.4-nano", messages: [{ role: "user", content: "hi" }] })
      .catch((e: unknown) => e as PollinationsError);
    expect(err).toBeInstanceOf(PollinationsError);
    expect(err.message).toBe("Authorization failed — reconnect your Pollinations account.");
  });

  it("surfaces a 402 as the top-up message", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ error: { message: "no funds" } }), {
        status: 402,
        headers: { "content-type": "application/json" },
      })
    );
    const client = createPollinationsClient({
      fetchImpl,
      getToken: () => Promise.resolve("sk_test"),
      maxRetries: 1,
    });

    const err = await client
      .generate({ model: "openai/gpt-5.4-nano", messages: [{ role: "user", content: "hi" }] })
      .catch((e: unknown) => e as PollinationsError);
    expect(err.message).toMatch(/Insufficient Pollen balance/);
  });
});
