// Feature: screen-share-zero-overhead, Property 9: Preview is paused on native
// start and shown for CEF — preview is paused (`isPreviewHidden` true with no CEF
// preview session opened for the shared source) if and only if the share is a
// native share; CEF (non-native) shares always start with the preview shown.
//
// Validates: Requirements 5.1, 5.4

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  resolvePreviewStartState,
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
  it("pauses preview (and opens no CEF preview) iff the share is native", () => {
    fc.assert(
      fc.property(previewKindArb, (kind) => {
        const decision = resolvePreviewStartState(kind);
        const isNative = kind === "native";

        // The "paused state" is precisely: preview hidden AND no CEF preview
        // session opened for the shared source (Req 5.1).
        const isPausedState = decision.isPreviewHidden && !decision.openCefPreview;

        // iff: paused state holds exactly when the share is native.
        expect(isPausedState).toBe(isNative);

        // Component invariants that make up the iff, stated explicitly so a
        // counterexample localizes the break.
        expect(decision.isPreviewHidden).toBe(isNative);
        expect(decision.openCefPreview).toBe(!isNative);
      }),
      { numRuns: 100 },
    );
  });

  // Concrete anchors documenting the two endpoints of the iff.
  it("native => paused, no CEF preview", () => {
    expect(resolvePreviewStartState("native")).toEqual({
      isPreviewHidden: true,
      openCefPreview: false,
    });
  });

  it("cef => preview shown, CEF preview opened", () => {
    expect(resolvePreviewStartState("cef")).toEqual({
      isPreviewHidden: false,
      openCefPreview: true,
    });
  });
});
