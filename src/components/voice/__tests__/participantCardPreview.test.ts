// Frontend unit tests for the preview-paused placeholder and the resume flow.
//
// Validates: Requirements 5.2 (paused placeholder renders) and 5.3 (resume via
// the existing togglePreviewHidden flow reopens the CEF preview).
//
// Testing approach:
//   The repo's vitest setup runs in the "node" environment with no DOM testing
//   stack installed (no jsdom / happy-dom / @testing-library). So:
//     * Req 5.2 is verified by server-rendering the REAL `ParticipantCard` with
//       `react-dom/server` and asserting the "Preview paused" placeholder is in
//       the output when `isPreviewHidden` is true (and absent when false).
//     * Req 5.3 is verified at the resume seam used by `togglePreviewHidden`:
//       `resolvePreviewResume` drives the un-hide branching, and its
//       `openPreviewStream` opener calls the same exported
//       `getCustomPickerDesktopStream` the hook uses. We assert that opener is
//       invoked (i.e. a new preview capture is requested) and the resulting
//       state un-hides the preview (`isPreviewHidden` becomes false).
//   This is the appropriate seam because the full `togglePreviewHidden` lives
//   inside `useVoiceChannel` and cannot mount without a DOM + heavy media deps.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ParticipantCard } from "@/components/voice/ParticipantCard";
import type { GridItem, VoiceActions } from "@/components/voice/types";
import {
  getCustomPickerDesktopStream,
  resolvePreviewResume,
} from "@/hooks/useVoiceChannel";

function makeLocalScreenItem(overrides: Partial<GridItem> = {}): GridItem {
  return {
    id: "local-screen-1",
    userId: "user-1",
    name: "You",
    avatar: null,
    stream: null,
    isLocal: true,
    type: "screen",
    isStreaming: true,
    isMuted: false,
    isDeafened: false,
    isSpeaking: false,
    ...overrides,
  };
}

function renderCard(item: GridItem, voiceActions: VoiceActions): string {
  return renderToStaticMarkup(
    React.createElement(ParticipantCard, {
      item,
      isFocused: false,
      isTray: false,
      globalDeafened: false,
      onClick: () => {},
      voiceActions,
      watchedStreams: {},
      streamThumbnails: {},
    }),
  );
}

describe("ParticipantCard — preview-paused placeholder (Req 5.2)", () => {
  it("renders the 'Preview paused' placeholder when the local screen tile is hidden", () => {
    const markup = renderCard(makeLocalScreenItem(), {
      isPreviewHidden: true,
      togglePreviewHidden: () => {},
    });

    expect(markup).toContain("Preview paused");
  });

  it("does not render the placeholder when the preview is shown", () => {
    const markup = renderCard(makeLocalScreenItem({ stream: null }), {
      isPreviewHidden: false,
      togglePreviewHidden: () => {},
    });

    expect(markup).not.toContain("Preview paused");
  });

  it("does not render the placeholder for a remote screen tile even if hidden flag is set", () => {
    const markup = renderCard(makeLocalScreenItem({ isLocal: false }), {
      isPreviewHidden: true,
      togglePreviewHidden: () => {},
    });

    // The placeholder is local-only (isScreen && item.isLocal && isPreviewHidden).
    expect(markup).not.toContain("Preview paused");
  });
});

describe("togglePreviewHidden resume flow (Req 5.3)", () => {
  const getUserMedia = vi.fn();

  beforeEach(() => {
    getUserMedia.mockReset();
    // Provide a minimal navigator.mediaDevices so the real
    // getCustomPickerDesktopStream can request a desktop capture stream.
    vi.stubGlobal("navigator", {
      mediaDevices: { getUserMedia },
    } as unknown as Navigator);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reopens the CEF preview from the paused state and un-hides it", async () => {
    const reopenedStream = { id: "reopened-preview" } as unknown as MediaStream;
    getUserMedia.mockResolvedValue(reopenedStream);

    // The opener mirrors exactly what togglePreviewHidden does for a known
    // native source: call getCustomPickerDesktopStream for that window.
    const openPreviewStream = vi.fn(() =>
      getCustomPickerDesktopStream({
        sourceId: "window-123",
        sourceKind: "window",
        withAudio: false,
        videoConstraints: {},
        desktopMandatoryConstraints: {},
      }),
    );

    const outcome = await resolvePreviewResume({
      canReopenNativePreview: true, // paused native share with a known source
      openPreviewStream,
      cefFallbackStream: null,
    });

    // A new preview capture was requested (getCustomPickerDesktopStream ->
    // navigator.mediaDevices.getUserMedia was called).
    expect(openPreviewStream).toHaveBeenCalledTimes(1);
    expect(getUserMedia).toHaveBeenCalledTimes(1);

    // The preview is now shown with the freshly opened stream.
    expect(outcome.isPreviewHidden).toBe(false);
    expect(outcome.openedStream).toBe(true);
    expect(outcome.stream).toBe(reopenedStream);
    expect(outcome.reopenFailed).toBe(false);
  });

  it("stays paused if reopening the native preview fails", async () => {
    getUserMedia.mockRejectedValue(new Error("capture denied"));

    const openPreviewStream = vi.fn(() =>
      getCustomPickerDesktopStream({
        sourceId: "window-123",
        sourceKind: "window",
        withAudio: false,
        videoConstraints: {},
        desktopMandatoryConstraints: {},
      }),
    );

    const outcome = await resolvePreviewResume({
      canReopenNativePreview: true,
      openPreviewStream,
      cefFallbackStream: null,
    });

    expect(openPreviewStream).toHaveBeenCalledTimes(1);
    expect(outcome.isPreviewHidden).toBe(true);
    expect(outcome.openedStream).toBe(false);
    expect(outcome.reopenFailed).toBe(true);
    expect(outcome.stream).toBeNull();
  });

  it("restores the existing CEF stream without opening a new capture", async () => {
    const existingCef = { id: "existing-cef" } as unknown as MediaStream;
    const openPreviewStream = vi.fn();

    const outcome = await resolvePreviewResume({
      canReopenNativePreview: false, // CEF share: no known native source to reopen
      openPreviewStream,
      cefFallbackStream: existingCef,
    });

    expect(openPreviewStream).not.toHaveBeenCalled();
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(outcome.isPreviewHidden).toBe(false);
    expect(outcome.stream).toBe(existingCef);
  });
});
