import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ParticipantCard } from "@/components/voice/ParticipantCard";
import type { GridItem, VoiceActions } from "@/components/voice/types";

function makeScreenItem(overrides: Partial<GridItem> = {}): GridItem {
  return {
    id: "local-screen-1",
    userId: "user-1",
    name: "Alice's Stream",
    avatar: null,
    stream: null,
    isLocal: false,
    type: "screen",
    isStreaming: true,
    isMuted: false,
    isDeafened: false,
    isSpeaking: false,
    ...overrides,
  };
}

function renderCard(
  item: GridItem,
  voiceActions: VoiceActions,
  watchedStreams: Record<string, boolean>,
  isTray = false,
  isFocused = false,
  suppressVideo = false,
  streamThumbnails: Record<string, string> = {},
) {
  return renderToStaticMarkup(
    React.createElement(ParticipantCard, {
      item,
      isFocused,
      isTray,
      globalDeafened: false,
      onClick: () => {},
      voiceActions,
      watchedStreams,
      streamThumbnails,
      suppressVideo,
    }),
  );
}

describe("ParticipantCard stream watchers", () => {
  it("shows watcher identities on the local stream tile", () => {
    const markup = renderCard(
      makeScreenItem({ isLocal: true, name: "You" }),
      {
        watchersByStreamer: {
          "user-1": [
            { userId: "user-2", name: "Bob", avatar: null, isLocal: false },
          ],
        },
      },
      {},
    );

    expect(markup).toContain("1 viewer");
    expect(markup).toContain("Bob");
  });

  it("shows watcher identities on a watched remote stream tile", () => {
    const markup = renderCard(
      makeScreenItem(),
      {
        watchersByStreamer: {
          "user-1": [
            { userId: "user-2", name: "Bob", avatar: null, isLocal: false },
            { userId: "user-3", name: "Carla", avatar: null, isLocal: false },
          ],
        },
      },
      { "user-1": true },
    );

    expect(markup).toContain("2 viewers");
    expect(markup).toContain("Bob, Carla");
  });

  it("hides watcher identities on tray cards", () => {
    const markup = renderCard(
      makeScreenItem({ isLocal: true, name: "You" }),
      {
        watchersByStreamer: {
          "user-1": [
            { userId: "user-2", name: "Bob", avatar: null, isLocal: false },
          ],
        },
      },
      {},
      true,
    );

    expect(markup).not.toContain("1 viewer");
    expect(markup).not.toContain("Bob");
  });

  it("hides the watch prompt on a focused tray stream even before the watch toggle catches up", () => {
    const markup = renderCard(
      makeScreenItem(),
      {},
      {},
      true,
      true,
      true,
    );

    expect(markup).not.toContain("Watch Stream");
  });

  it("renders a thumbnail poster for a focused tray stream when live video is suppressed", () => {
    const markup = renderCard(
      makeScreenItem(),
      {},
      {},
      true,
      true,
      true,
      { "user-1": "data:image/png;base64,thumb" },
    );

    expect(markup).toContain("data:image/png;base64,thumb");
    expect(markup).not.toContain("Watch Stream");
  });

  it("shows a clean stream badge and no avatar overlay when a tray stream poster is available", () => {
    const markup = renderCard(
      makeScreenItem({ avatar: "/avatars/alice.png" }),
      {},
      {},
      true,
      true,
      true,
      { "user-1": "data:image/png;base64,thumb" },
    );

    expect(markup).toContain("Alice</span>");
    expect(markup).not.toContain("Alice&#x27;s Stream</span>");
    expect(markup).not.toContain("avatars/alice.png");
    expect(markup).not.toContain("LIVE");
    expect(markup).not.toContain("FPS");
  });
});
