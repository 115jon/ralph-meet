import { describe, expect, it } from "vitest";

import { PUBLIC_POLICY } from "./public-policy";

describe("PUBLIC_POLICY", () => {
  it("publishes stable first-party policy routes and the designated contact", () => {
    expect(PUBLIC_POLICY.privacyPath).toBe("/privacy");
    expect(PUBLIC_POLICY.codeSigningPath).toBe("/code-signing-policy");
    expect(PUBLIC_POLICY.contactEmail).toBe("115jon@proton.me");
  });
});
