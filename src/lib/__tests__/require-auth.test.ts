import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requestHeaders = vi.hoisted(() => new Map<string, string>());

vi.mock("@tanstack/react-start/server", () => ({
  getRequestHeader: (name: string) => requestHeaders.get(name),
}));
vi.mock("@/lib/console-logger", () => ({
  clog: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { requireAuth } from "@/lib/api-helpers";
import { checkKovaAuthSession } from "@/lib/kova-auth-server";

const fetchMock = vi.fn<typeof fetch>();

function kovaAnswers(response: Response | Error) {
  fetchMock.mockImplementation(async () => {
    if (response instanceof Error) throw response;
    return response.clone();
  });
}

const SIGNED_IN = { user: { id: "user-1" }, session: { id: "session-1" } };

beforeEach(() => {
  requestHeaders.clear();
  requestHeaders.set("cookie", "kova.session=abc");
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("checkKovaAuthSession", () => {
  it("returns the session when Kova has one", async () => {
    kovaAnswers(Response.json(SIGNED_IN));
    await expect(checkKovaAuthSession()).resolves.toMatchObject({
      status: "signed-in",
      user: { id: "user-1" },
    });
  });

  it("is signed out when Kova answers with no session", async () => {
    kovaAnswers(Response.json(null));
    await expect(checkKovaAuthSession()).resolves.toEqual({
      status: "signed-out",
    });
  });

  it("is signed out when Kova refuses the credentials", async () => {
    kovaAnswers(new Response("no", { status: 401 }));
    await expect(checkKovaAuthSession()).resolves.toEqual({
      status: "signed-out",
    });
  });

  it.each([
    ["a network failure", new TypeError("fetch failed")],
    ["a 502", new Response("bad gateway", { status: 502 })],
    ["a 503", new Response("down", { status: 503 })],
    ["a 429", new Response("slow down", { status: 429 })],
    ["an HTML error page on 200", new Response("<html>oops</html>")],
  ])("is unavailable on %s, not signed out", async (_label, answer) => {
    kovaAnswers(answer);
    await expect(checkKovaAuthSession()).resolves.toMatchObject({
      status: "unavailable",
    });
  });
});

describe("requireAuth", () => {
  it("returns the user id for a live session", async () => {
    kovaAnswers(Response.json(SIGNED_IN));
    await expect(requireAuth()).resolves.toEqual({ userId: "user-1" });
  });

  it("answers 401 only when Kova says there is no session", async () => {
    kovaAnswers(Response.json(null));
    const res = (await requireAuth()) as Response;
    expect(res.status).toBe(401);
  });

  it("answers 503 AUTH_UNAVAILABLE when Kova is unreachable", async () => {
    kovaAnswers(new TypeError("fetch failed"));
    const res = (await requireAuth()) as Response;
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({
      code: "AUTH_UNAVAILABLE",
    });
  });

  it("answers 503 when Kova returns a 5xx", async () => {
    kovaAnswers(new Response("down", { status: 500 }));
    const res = (await requireAuth()) as Response;
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("5");
  });

  it("answers 503 when Kova's 2xx body is not JSON", async () => {
    kovaAnswers(new Response("<html>edge error</html>"));
    const res = (await requireAuth()) as Response;
    expect(res.status).toBe(503);
  });

  it("answers 503 when Kova hangs past the session timeout", async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockImplementation(() => new Promise<Response>(() => {}));
      const pending = requireAuth();
      await vi.advanceTimersByTimeAsync(5_000);
      const res = (await pending) as Response;
      expect(res.status).toBe(503);
    } finally {
      vi.useRealTimers();
    }
  });

  it("answers 401 without asking Kova when there are no credentials", async () => {
    requestHeaders.clear();
    const res = (await requireAuth()) as Response;
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers 503 when the bearer-token check cannot reach Kova", async () => {
    // The cookie check says no session; the desktop token check is down.
    fetchMock
      .mockResolvedValueOnce(Response.json(null))
      .mockRejectedValueOnce(new TypeError("fetch failed"));
    const req = new Request("https://meet.test/api/x", {
      headers: { authorization: "Bearer desktop-token" },
    });
    const res = (await requireAuth(req)) as Response;
    expect(res.status).toBe(503);
  });

  it("accepts a desktop bearer token Kova recognises", async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json(null))
      .mockResolvedValueOnce(Response.json(SIGNED_IN));
    const req = new Request("https://meet.test/api/x", {
      headers: { authorization: "Bearer desktop-token" },
    });
    await expect(requireAuth(req)).resolves.toEqual({ userId: "user-1" });
  });
});
