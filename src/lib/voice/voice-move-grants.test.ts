import { afterEach, describe, expect, it } from "vitest";

import {
  clearVoiceMoveGrant,
  rememberVoiceMoveGrant,
  voiceMoveGrantFor,
} from "./voice-move-grants";

describe("client move grant cache", () => {
  afterEach(() => clearVoiceMoveGrant());

  it("keeps only the latest move's grant (A -> B -> C drops B)", () => {
    rememberVoiceMoveGrant("vc-b", "grant-b", 10_000);
    expect(voiceMoveGrantFor("vc-b", 0)).toBe("grant-b");
    rememberVoiceMoveGrant("vc-c", "grant-c", 10_000);
    expect(voiceMoveGrantFor("vc-b", 0)).toBeUndefined();
    expect(voiceMoveGrantFor("vc-c", 0)).toBe("grant-c");
  });

  it("drops an expired grant", () => {
    rememberVoiceMoveGrant("vc-b", "grant-b", 1_000);
    expect(voiceMoveGrantFor("vc-b", 1_000)).toBeUndefined();
    expect(voiceMoveGrantFor("vc-b", 0)).toBeUndefined();
  });

  it("clears for the joined channel only, or all on leave", () => {
    rememberVoiceMoveGrant("vc-b", "grant-b", 10_000);
    clearVoiceMoveGrant("vc-x");
    expect(voiceMoveGrantFor("vc-b", 0)).toBe("grant-b");
    clearVoiceMoveGrant("vc-b");
    expect(voiceMoveGrantFor("vc-b", 0)).toBeUndefined();
    rememberVoiceMoveGrant("vc-b", "grant-b", 10_000);
    clearVoiceMoveGrant();
    expect(voiceMoveGrantFor("vc-b", 0)).toBeUndefined();
  });
});
