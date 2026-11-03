import { describe, expect, it } from "vitest";

import { legacyHostRedirect } from "../legacy-host";

const OLD = "https://meet.115jon.site";

function navigate(url: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  if (!headers.has("Sec-Fetch-Mode")) headers.set("Sec-Fetch-Mode", "navigate");
  return new Request(url, { ...init, headers });
}

describe("legacyHostRedirect", () => {
  it("301s a page load on the old host to the same path on the Yap host", () => {
    const response = legacyHostRedirect(
      navigate(`${OLD}/invite/abc?ref=x#ignored`),
    );

    expect(response?.status).toBe(301);
    expect(response?.headers.get("Location")).toBe(
      "https://yap.115jon.com/invite/abc?ref=x",
    );
  });

  it("redirects HEAD page loads too", () => {
    expect(
      legacyHostRedirect(navigate(`${OLD}/chat`, { method: "HEAD" }))?.status,
    ).toBe(301);
  });

  it("leaves other hosts alone", () => {
    expect(legacyHostRedirect(navigate("https://yap.115jon.com/chat"))).toBe(
      null,
    );
    expect(legacyHostRedirect(navigate("http://localhost:5173/chat"))).toBe(
      null,
    );
  });

  it("serves what installed clients and crawlers call on the old host", () => {
    for (const path of [
      "/api/users/me",
      "/api/gateway",
      "/api/oembed?url=x",
      "/share/tok_123",
      "/.well-known/assetlinks.json",
    ]) {
      expect(legacyHostRedirect(navigate(`${OLD}${path}`))).toBeNull();
    }
    // Not a navigation: fetch(), assets, crawlers without Sec-Fetch-*.
    expect(
      legacyHostRedirect(
        new Request(`${OLD}/chat`, { headers: { "Sec-Fetch-Mode": "cors" } }),
      ),
    ).toBeNull();
    expect(legacyHostRedirect(new Request(`${OLD}/`))).toBeNull();
    expect(
      legacyHostRedirect(
        navigate(`${OLD}/chat`, { headers: { Upgrade: "websocket" } }),
      ),
    ).toBeNull();
    expect(
      legacyHostRedirect(navigate(`${OLD}/chat`, { method: "POST" })),
    ).toBeNull();
  });

  it("serves auth callbacks where the sign-in started", () => {
    for (const query of ["kova_auth_code=a", "ralph_auth_code=b", "code=c"]) {
      expect(legacyHostRedirect(navigate(`${OLD}/chat?${query}`))).toBeNull();
    }
  });
});
