import { describe, expect, it } from "vitest";

import { legacyHostRedirect } from "../legacy-host";

const OLD = "https://meet.115jon.site";

describe("legacyHostRedirect", () => {
  it("301s to the same path and query on the Yap host", () => {
    const response = legacyHostRedirect(
      new Request(`${OLD}/invite/abc?ref=x#ignored`),
    );

    expect(response?.status).toBe(301);
    expect(response?.headers.get("Location")).toBe(
      "https://yap.115jon.com/invite/abc?ref=x",
    );
  });

  it.each([
    ["/api/gateway", { headers: { Upgrade: "websocket" } }],
    ["/api/messages", { method: "POST", body: "{}" }],
    ["/share/tok", {}],
    ["/.well-known/assetlinks.json", {}],
    ["/sign-in?kova_auth_code=c&state=s", {}],
    ["/assets/app.js", { method: "HEAD" }],
  ] as const)("redirects %s too", (path, init) => {
    const response = legacyHostRedirect(new Request(`${OLD}${path}`, init));
    expect(response?.status).toBe(301);
    expect(response?.headers.get("Location")).toBe(
      `https://yap.115jon.com${path}`,
    );
  });

  it("leaves other hosts alone", () => {
    expect(legacyHostRedirect(new Request("https://yap.115jon.com/chat"))).toBe(
      null,
    );
    expect(legacyHostRedirect(new Request("http://localhost:5173/chat"))).toBe(
      null,
    );
  });
});
