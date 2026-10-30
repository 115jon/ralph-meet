/**
 * Dev-only floating player fixtures (mounted by UiFixtures), over the chat
 * shell so the composer and tab bar are there to avoid.
 *
 *   fl-players     now playing + your stream preview + soundboard together
 *   fl-listen      now playing only
 *   fl-stream      stream preview only (a live canvas stream)
 *   fl-soundboard  soundboard manager only
 *
 * Query params: &state=min (start minimised), &corner=top-left|top-right|
 * bottom-left|bottom-right (start corner). Both are written to the players'
 * saved prefs before they mount.
 */

import FloatingStreamPreview from "@/components/chat/FloatingStreamPreview";
import { FloatingListenTogetherPlayer } from "@/components/chat/FloatingListenTogetherPlayer";
import { FloatingSoundboardManager } from "@/components/chat/FloatingSoundboardManager";
import {
  FLOATING_CORNERS,
  type FloatingCorner,
  writeFloatingPrefs,
} from "@/components/chat/floating/floating-geometry";
import shareFrame from "@/components/dev/assets/share-frame.webp";
import { LISTEN_ROOM, listenSnapshot } from "@/components/dev/UiFixtures";
import type { SFUClient } from "@/lib/sfu-client";
import { useListenTogetherStore } from "@/stores/useListenTogetherStore";
import { useVoiceSoundboardStore } from "@/stores/useVoiceSoundboardStore";
import { useEffect, useState, type ReactNode } from "react";
const fakeSfu = {
  voiceGW: { isReady: true, sendAppEvent: () => true },
  resumeAudioContext: () => {},
  on: () => () => {},
  off: () => {},
} as unknown as SFUClient;

const noop = () => {};
const PLAYER_IDS = ["listen-together", "stream-preview-0", "soundboard"];

function param(name: string) {
  return new URLSearchParams(window.location.search).get(name);
}

/** Seed saved prefs from the URL before any player reads them. */
function seedPrefs() {
  const minimized = param("state") === "min";
  const corner = param("corner") as FloatingCorner | null;
  if (!minimized && !corner) return;
  for (const id of PLAYER_IDS) {
    writeFloatingPrefs(id, {
      corner:
        corner && FLOATING_CORNERS.includes(corner)
          ? corner
          : id === "soundboard"
            ? "top-right"
            : "bottom-right",
      minimized,
    });
  }
}

/** A live MediaStream of the share frame, so the preview shows video. */
function useCanvasStream() {
  const [stream, setStream] = useState<MediaStream | null>(null);
  useEffect(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1280;
    canvas.height = 720;
    const ctx = canvas.getContext("2d");
    const image = new Image();
    let frame = 0;
    let tick = 0;
    image.onload = () => {
      const draw = () => {
        tick += 1;
        ctx?.drawImage(image, 0, 0, canvas.width, canvas.height);
        if (ctx) {
          ctx.fillStyle = "rgba(124, 92, 255, 0.9)"; // ds-allow:raw-color fake cursor
          ctx.beginPath();
          ctx.arc(640 + Math.sin(tick / 20) * 300, 400, 14, 0, Math.PI * 2);
          ctx.fill();
        }
        frame = requestAnimationFrame(draw);
      };
      draw();
      setStream(canvas.captureStream(15));
    };
    image.src = shareFrame;
    return () => cancelAnimationFrame(frame);
  }, []);
  return stream;
}

function useListenSeed() {
  useEffect(() => {
    useListenTogetherStore
      .getState()
      .setSnapshot(LISTEN_ROOM, listenSnapshot(Date.now()));
    return () => useListenTogetherStore.getState().clearRoom(LISTEN_ROOM);
  }, []);
}

function useSoundboardSeed() {
  useEffect(() => {
    const store = useVoiceSoundboardStore.getState();
    const now = Date.now();
    ["Airhorn", "Sad trombone", "Drumroll"].forEach((name, index) =>
      store.upsertPlayback({
        playbackId: `fl-sb-${index}`,
        ownerId: "u-me",
        serverKey: "srv-ralph",
        name,
        isLocal: true,
        startedAt: now - index * 4_000,
        paused: index === 1,
        volume: 0.8,
      }),
    );
    return () =>
      useVoiceSoundboardStore.getState().clearServerPlaybacks("srv-ralph");
  }, []);
}

function ListenPlayer() {
  useListenSeed();
  return (
    <FloatingListenTogetherPlayer
      sfu={fakeSfu}
      roomSlug={LISTEN_ROOM}
      onOpenQueue={noop}
    />
  );
}

function StreamPlayer() {
  const stream = useCanvasStream();
  return (
    <FloatingStreamPreview
      userId="u-me"
      channelName="Lounge"
      displayName="Jon"
      previewStream={stream}
      primaryActionTooltip="Stop Streaming"
      primaryActionAriaLabel="Stop streaming"
      onPrimaryAction={noop}
      onNavigateToVoiceChannel={noop}
      menuProps={{
        isStreaming: true,
        onToggleScreenShare: noop,
        currentScreenQuality: "1080p30",
        availableQualities: ["720p30", "1080p30", "1080p60"],
        isStreamingAudio: true,
        onToggleStreamAudio: noop,
        onChangeSource: noop,
        showDisconnect: false,
        alwaysShowStreamPreview: false,
        onToggleAlwaysShowStreamPreview: noop,
      }}
    />
  );
}

function SoundboardPlayer() {
  useSoundboardSeed();
  return (
    <FloatingSoundboardManager
      serverId="srv-ralph"
      localUserId="u-me"
      sfu={fakeSfu}
    />
  );
}

export function FloatingFixture({
  surface,
  shell,
}: {
  surface: string;
  shell: ReactNode;
}) {
  const [ready] = useState(() => {
    seedPrefs();
    return true;
  });
  if (!ready) return null;
  const all = surface === "fl-players";
  return (
    <div className="relative h-full w-full">
      {shell}
      {all || surface === "fl-listen" ? <ListenPlayer /> : null}
      {all || surface === "fl-stream" ? <StreamPlayer /> : null}
      {all || surface === "fl-soundboard" ? <SoundboardPlayer /> : null}
    </div>
  );
}
