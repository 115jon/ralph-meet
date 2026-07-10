// Feature: screen-share-zero-overhead, Property 9: Preview is paused on native
// start and shown for CEF unless the user explicitly enables Always Show Stream
// Preview.
//
// Validates: Requirements 5.1, 5.4

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  resolvePreviewStartState,
  resolveScreenVideoSubscription,
  type ScreenSharePreviewKind,
} from "@/hooks/useVoiceChannel";

// Smart generator: constrain to the exact input space of the function — the
// `ScreenSharePreviewKind` union ("native" | "cef") — so every generated value
// is a valid share kind.
const previewKindArb: fc.Arbitrary<ScreenSharePreviewKind> = fc.constantFrom(
  "native",
  "cef",
);

describe("resolvePreviewStartState — Property 9 (preview-default decision)", () => {
  it("pauses preview on native shares iff Always Show Stream Preview is disabled", () => {
    fc.assert(
      fc.property(previewKindArb, fc.boolean(), (kind, alwaysShowPreview) => {
        const decision = resolvePreviewStartState(kind, alwaysShowPreview);
        const shouldPausePreview = kind === "native" && !alwaysShowPreview;

        // The "paused state" is precisely: preview hidden AND no CEF preview
        // session opened for the shared source (Req 5.1).
        const isPausedState =
          decision.isPreviewHidden && !decision.openCefPreview;

        expect(isPausedState).toBe(shouldPausePreview);

        // Component invariants that make up the iff, stated explicitly so a
        // counterexample localizes the break.
        expect(decision.isPreviewHidden).toBe(shouldPausePreview);
        expect(decision.openCefPreview).toBe(!shouldPausePreview);
      }),
      { numRuns: 100 },
    );
  });

  it("native + disabled override => paused, no CEF preview", () => {
    expect(resolvePreviewStartState("native", false)).toEqual({
      isPreviewHidden: true,
      openCefPreview: false,
    });
  });

  it("native + enabled override => preview shown, CEF preview opened", () => {
    expect(resolvePreviewStartState("native", true)).toEqual({
      isPreviewHidden: false,
      openCefPreview: true,
    });
  });

  it("cef => preview shown, CEF preview opened", () => {
    expect(resolvePreviewStartState("cef", false)).toEqual({
      isPreviewHidden: false,
      openCefPreview: true,
    });
  });
});

describe("resolveScreenVideoSubscription", () => {
  it("keeps screen video subscribed even when stream audio is always-heard", () => {
    fc.assert(
      fc.property(fc.boolean(), fc.boolean(), (alwaysHear, isWatched) => {
        expect(resolveScreenVideoSubscription({ alwaysHear, isWatched })).toBe(
          true,
        );
      }),
      { numRuns: 20 },
    );
  });
});
