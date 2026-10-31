import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import { AuthUnavailable, Unauthenticated } from "@/server/errors";
import {
  authenticate,
  KovaAuth,
  type Credentials,
  type KovaOptions,
} from "@/server/kova-auth";

const SIGNED_IN = { user: { id: "user-1" }, session: { id: "session-1" } };

/** A fake Kova: answers each get-session call in turn, the last one forever. */
function fakeKova(...answers: Array<Response | Error | "hang">) {
  const calls: Array<{ url: string; headers: Headers; signal?: AbortSignal }> =
    [];
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const signal = init?.signal ?? undefined;
    calls.push({
      url: String(input),
      headers: new Headers(init?.headers),
      signal,
    });
    const answer = answers[Math.min(calls.length, answers.length) - 1];
    if (answer === "hang") return new Promise<Response>(() => {});
    if (answer instanceof Error) throw answer;
    return answer.clone();
  });
  const options: KovaOptions = {
    url: "https://kova.test",
    publishableKey: "pk_test",
    timeout: "20 millis",
    fetch,
  };

  return { calls, layer: KovaAuth.layerWith(options) };
}

const cookieOnly: Credentials = {
  authorization: null,
  cookie: "kova.session=abc",
  queryToken: null,
};

function run(credentials: Credentials, kova: ReturnType<typeof fakeKova>) {
  return Effect.runPromise(
    authenticate(credentials).pipe(
      Effect.map((identity) => ({ ok: true as const, identity })),
      Effect.catch((error) => Effect.succeed({ ok: false as const, error })),
      Effect.provide(kova.layer),
    ),
  );
}

describe("KovaAuth.lookup", () => {
  it("finds the session and forwards only the session headers", async () => {
    const kova = fakeKova(Response.json(SIGNED_IN));
    const result = await run(
      {
        authorization: "Bearer t1",
        cookie: "kova.session=abc",
        queryToken: null,
      },
      kova,
    );

    expect(result).toEqual({ ok: true, identity: SIGNED_IN });
    expect(kova.calls).toHaveLength(1);
    expect(kova.calls[0].url).toBe("https://kova.test/api/auth/get-session");
    expect(Object.fromEntries(kova.calls[0].headers)).toEqual({
      authorization: "Bearer t1",
      cookie: "kova.session=abc",
      "x-publishable-key": "pk_test",
    });
  });

  it("is Unauthenticated without asking Kova when there are no credentials", async () => {
    const kova = fakeKova(Response.json(SIGNED_IN));
    const result = await run(
      { authorization: null, cookie: null, queryToken: null },
      kova,
    );

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toBeInstanceOf(Unauthenticated);
    expect(kova.calls).toHaveLength(0);
  });

  it.each([
    ["a 2xx with no session", Response.json(null)],
    ["a 2xx with no user", Response.json({ session: { id: "s" } })],
    ["a 401", new Response("no", { status: 401 })],
    ["a 403", new Response("no", { status: 403 })],
  ])("is Unauthenticated on %s", async (_label, answer) => {
    const result = await run(cookieOnly, fakeKova(answer));

    expect(!result.ok && result.error).toBeInstanceOf(Unauthenticated);
  });

  it.each([
    ["a network failure", new TypeError("fetch failed"), "TypeError"],
    ["a 500", new Response("down", { status: 500 }), "HTTP 500"],
    ["a 502", new Response("bad gateway", { status: 502 }), "HTTP 502"],
    ["a 503", new Response("down", { status: 503 }), "HTTP 503"],
    ["a 429", new Response("slow down", { status: 429 }), "HTTP 429"],
    ["a 408", new Response("slow", { status: 408 }), "HTTP 408"],
    [
      "an HTML page on 200",
      new Response("<html>oops</html>"),
      "unreadable body",
    ],
  ])("is AuthUnavailable on %s", async (_label, answer, reason) => {
    const result = await run(cookieOnly, fakeKova(answer));

    expect(!result.ok && result.error).toBeInstanceOf(AuthUnavailable);
    expect(!result.ok && result.error).toMatchObject({ reason });
  });

  it("is AuthUnavailable when Kova hangs, and aborts the request", async () => {
    const kova = fakeKova("hang");
    const result = await run(cookieOnly, kova);

    expect(!result.ok && result.error).toBeInstanceOf(AuthUnavailable);
    expect(!result.ok && result.error).toMatchObject({ reason: "timeout" });
    expect(kova.calls[0].signal?.aborted).toBe(true);
  });
});

describe("authenticate", () => {
  it("tries the bearer token alone when the request headers find no session", async () => {
    const kova = fakeKova(Response.json(null), Response.json(SIGNED_IN));
    const result = await run(
      { authorization: "Bearer desktop", cookie: "stale=1", queryToken: null },
      kova,
    );

    expect(result).toEqual({ ok: true, identity: SIGNED_IN });
    expect(Object.fromEntries(kova.calls[1].headers)).toEqual({
      authorization: "Bearer desktop",
      "x-publishable-key": "pk_test",
    });
  });

  it("uses ?token= when there is no bearer header", async () => {
    const kova = fakeKova(Response.json(null), Response.json(SIGNED_IN));
    const result = await run(
      { authorization: null, cookie: "stale=1", queryToken: "from-query" },
      kova,
    );

    expect(result.ok).toBe(true);
    expect(kova.calls[1].headers.get("authorization")).toBe(
      "Bearer from-query",
    );
  });

  it("stays AuthUnavailable when Kova was down for the headers and says no to the token", async () => {
    const kova = fakeKova(
      new Response("down", { status: 503 }),
      Response.json(null),
    );
    const result = await run(
      { authorization: "Bearer desktop", cookie: null, queryToken: null },
      kova,
    );

    expect(!result.ok && result.error).toBeInstanceOf(AuthUnavailable);
  });

  it("is AuthUnavailable when only the token check cannot reach Kova", async () => {
    const kova = fakeKova(Response.json(null), new TypeError("fetch failed"));
    const result = await run(
      { authorization: "Bearer desktop", cookie: null, queryToken: null },
      kova,
    );

    expect(!result.ok && result.error).toBeInstanceOf(AuthUnavailable);
  });

  it("is Unauthenticated when both checks say no", async () => {
    const kova = fakeKova(Response.json(null));
    const result = await run(
      { authorization: "Bearer desktop", cookie: null, queryToken: null },
      kova,
    );

    expect(!result.ok && result.error).toBeInstanceOf(Unauthenticated);
    expect(kova.calls).toHaveLength(2);
  });
});
