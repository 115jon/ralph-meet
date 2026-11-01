import { describe, expect, it } from "vitest";
import { signInMethodLabels } from "../sign-in-methods";

describe("signInMethodLabels", () => {
  it("names each linked provider in sign-in page order", () => {
    expect(signInMethodLabels(["credential", "google"])).toEqual([
      "Google",
      "Email & password",
    ]);
    expect(signInMethodLabels(["discord", "google", "github"])).toEqual([
      "Google",
      "Discord",
      "GitHub",
    ]);
  });

  it("lists a provider once", () => {
    expect(signInMethodLabels(["google", "Google", "google"])).toEqual([
      "Google",
    ]);
  });

  it("calls an account with no linked rows a magic-link account", () => {
    expect(signInMethodLabels([])).toEqual(["Magic link"]);
  });

  it("still shows a provider it has no label for", () => {
    expect(signInMethodLabels(["credential", "keycloak"])).toEqual([
      "Email & password",
      "Keycloak",
    ]);
  });
});
