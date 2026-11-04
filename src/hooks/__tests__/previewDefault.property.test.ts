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
  resolveStreamThumbnails,
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
  it("pauses preview on native shares iff Always show stream preview is disabled", () => {
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
  it("pulls screen video only while the share is watched or on stage", () => {
    fc.assert(
      fc.property(fc.boolean(), fc.boolean(), (isWatched, isFocused) => {
        expect(resolveScreenVideoSubscription({ isWatched, isFocused })).toBe(
          isWatched || isFocused,
        );
      }),
      { numRuns: 20 },
    );
  });

  it("shows an unwatched share's broadcast still, keeping local and captured ones", () => {
    const captured = { me: "local-capture", bob: "old-capture" };
    const merged = resolveStreamThumbnails(
      captured,
      [
        { user_id: "me", stream_preview_url: "my-broadcast" },
        { user_id: "bob", stream_preview_url: "bob-broadcast" },
        { user_id: "ann", stream_preview_url: "ann-broadcast" },
        { user_id: "cy", stream_preview_url: null },
      ],
      "me",
    );
    expect(merged).toEqual({
      me: "local-capture",
      bob: "bob-broadcast",
      ann: "ann-broadcast",
    });
    expect(captured).toEqual({ me: "local-capture", bob: "old-capture" });
    // Nothing to add: the same object, so memoized consumers keep theirs.
    expect(resolveStreamThumbnails(captured, [], "me")).toBe(captured);
  });

  it("does not pull an unwatched share's video", () => {
    expect(
      resolveScreenVideoSubscription({ isWatched: false, isFocused: false }),
    ).toBe(false);
  });
});
