// @vitest-environment jsdom

import type { ListenTogetherPlaybackState } from "@/components/chat/listen-together-playback";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ListenTogetherNowPlayingCard } from "../ListenTogetherNowPlayingCard";

function makePlaybackState(
  overrides: Partial<ListenTogetherPlaybackState> = {},
): ListenTogetherPlaybackState {
  const currentEntry = {
    entryId: "entry-1",
    requestedAt: 1_000,
    requester: {
      userId: "user-1",
      displayName: "Alice",
      avatarUrl: null,
      avatarDisplay: null,
    },
    track: {
      kind: "music" as const,
      id: "track-1",
      provider: "youtube" as const,
      videoId: "video-1",
      title: "Track One",
      artist: "Artist",
      album: null,
      durationMs: 180_000,
      artworkUrl: "https://img.example/track-1.jpg",
      canonicalUrl: "https://www.youtube.com/watch?v=video-1",
      sourceUrl: null,
      sourceLabel: "YouTube",
    },
    importBatchId: null,
    importBatchLabel: null,
  };

  return {
    currentEntry,
    durationMs: currentEntry.track.durationMs,
    effectiveSeekValue: 5_000,
    error: null,
    isPaused: false,
    localVolume: 1,
    loudnessEnabled: true,
    loudnessPreset: "balanced",
    localPlayback: null,
    progressMax: currentEntry.track.durationMs,
    setLocalVolume: vi.fn(),
    setLocalPlayback: vi.fn(),
    updateLoudnessSettings: vi.fn(),
    snapshot: {
      roomSlug: "room-1",
      revision: 1,
      paused: false,
      currentEntryId: currentEntry.entryId,
      anchorPositionMs: 0,
      anchorUpdatedAt: 1_000,
      lastUpdatedAt: 1_000,
      queue: [currentEntry],
      currentEntry,
      positionMs: 5_000,
      durationMs: currentEntry.track.durationMs,
    },
    ...overrides,
  };
}

describe("ListenTogetherNowPlayingCard", () => {
  it("anchors the loudness switch thumb inside its compact audio menu", () => {
    render(
      <ListenTogetherNowPlayingCard
        playback={makePlaybackState()}
        sfu={{ voiceGW: { sendAppEvent: vi.fn() } } as never}
        roomSlug="room-1"
        variant="panel"
      />,
    );

    fireEvent.click(screen.getByText("Audio options"));

    const thumb = screen
      .getByRole("switch", { name: "Turn off loudness control" })
      .querySelector("span");

    expect(thumb).toHaveClass("left-0.5");
  });

  it("updates local loudness control without sending a room command", async () => {
    const playback = makePlaybackState({
      loudnessEnabled: true,
      loudnessPreset: "balanced",
      updateLoudnessSettings: vi.fn(),
    });
    const sendAppEvent = vi.fn();
    const user = userEvent.setup();

    render(
      <ListenTogetherNowPlayingCard
        playback={playback}
        sfu={{ voiceGW: { sendAppEvent } } as never}
        roomSlug="room-1"
        variant="panel"
      />,
    );

    fireEvent.click(screen.getByText("Audio options"));
    await user.click(
      screen.getByRole("switch", { name: "Turn off loudness control" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Use night loudness control" }),
    );

    expect(
      screen.getByRole("button", { name: "Use balanced loudness control" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(playback.updateLoudnessSettings).toHaveBeenCalledWith({
      enabled: false,
    });
    expect(playback.updateLoudnessSettings).toHaveBeenCalledWith({
      preset: "night",
    });
    expect(sendAppEvent).not.toHaveBeenCalled();
  });
  it("renders a compact mini player and forwards control actions", () => {
    const sendAppEvent = vi.fn();
    const resumeAudioContext = vi.fn();
    const onOpenQueue = vi.fn();

    render(
      <ListenTogetherNowPlayingCard
        playback={makePlaybackState()}
        sfu={{ resumeAudioContext, voiceGW: { sendAppEvent } } as any}
        roomSlug="room-1"
        variant="mini"
        onOpenQueue={onOpenQueue}
      />,
    );

    expect(screen.getByText("Track One")).toBeInTheDocument();
    expect(screen.getByText("Requested by Alice")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Open listen together queue" }),
    );
    expect(onOpenQueue).toHaveBeenCalledTimes(1);

    fireEvent.click(
      screen.getByRole("button", { name: "Pause shared playback" }),
    );
    expect(resumeAudioContext).toHaveBeenCalledTimes(1);
    expect(sendAppEvent).toHaveBeenCalledWith({
      type: "listen_together.pause",
      room_slug: "room-1",
      paused: true,
      entryId: "entry-1",
    });
  });

  it("only applies optimistic pause state after the gateway accepts the command", () => {
    const sendAppEvent = vi.fn(() => false);
    const playback = makePlaybackState();

    render(
      <ListenTogetherNowPlayingCard
        playback={playback}
        sfu={{ voiceGW: { sendAppEvent } } as never}
        roomSlug="room-1"
        variant="mini"
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Pause shared playback" }),
    );

    expect(sendAppEvent).toHaveBeenCalledTimes(1);
    expect(playback.setLocalPlayback).not.toHaveBeenCalled();
  });

  it.each(["mini", "panel"] as const)(
    "coalesces %s player seek changes into one command on pointer release",
    (variant) => {
      const sendAppEvent = vi.fn(() => true);
      const playback = makePlaybackState();

      render(
        <ListenTogetherNowPlayingCard
          playback={playback}
          sfu={{ voiceGW: { sendAppEvent } } as never}
          roomSlug="room-1"
          variant={variant}
        />,
      );

      const slider = screen.getByLabelText("Seek Track One");
      fireEvent.change(slider, { target: { value: "10" } });
      fireEvent.change(slider, { target: { value: "20" } });
      fireEvent.change(slider, { target: { value: "30" } });
      fireEvent.pointerUp(slider);

      expect(sendAppEvent).toHaveBeenCalledTimes(1);
      expect(sendAppEvent).toHaveBeenCalledWith({
        type: "listen_together.seek",
        room_slug: "room-1",
        positionMs: 30,
        entryId: "entry-1",
      });
      expect(playback.setLocalPlayback).toHaveBeenLastCalledWith(
        "room-1",
        expect.objectContaining({
          positionMs: 30,
          source: "seek",
          accepted: true,
        }),
      );
    },
  );

  it.each(["mini", "panel"] as const)(
    "restores the prior %s playback override when seek is cancelled",
    (variant) => {
      const priorPlayback = {
        paused: true,
        positionMs: 4_000,
        entryId: "entry-1",
        snapshotRevision: 1,
        source: "command" as const,
        accepted: true,
      };
      const playback = Object.assign(makePlaybackState(), {
        localPlayback: priorPlayback,
      }) as ListenTogetherPlaybackState;

      render(
        <ListenTogetherNowPlayingCard
          playback={playback}
          sfu={{ voiceGW: { sendAppEvent: vi.fn(() => true) } } as never}
          roomSlug="room-1"
          variant={variant}
        />,
      );

      const slider = screen.getByLabelText("Seek Track One");
      fireEvent.change(slider, { target: { value: "30" } });
      fireEvent.pointerCancel(slider);

      expect(playback.setLocalPlayback).toHaveBeenLastCalledWith(
        "room-1",
        priorPlayback,
      );
    },
  );

  it("commits Arrow, Home, End, and Enter seeks on keyup and cancels with Escape", () => {
    const sendAppEvent = vi.fn(() => true);
    const playback = makePlaybackState();

    render(
      <ListenTogetherNowPlayingCard
        playback={playback}
        sfu={{ voiceGW: { sendAppEvent } } as never}
        roomSlug="room-1"
        variant="mini"
      />,
    );

    const slider = screen.getByLabelText("Seek Track One");
    for (const [key, value] of [
      ["ArrowRight", "40"],
      ["ArrowUp", "41"],
      ["ArrowDown", "42"],
      ["Home", "0"],
      ["End", "180000"],
      ["PageUp", "179000"],
      ["PageDown", "178000"],
      ["Enter", "50"],
    ]) {
      fireEvent.change(slider, { target: { value } });
      fireEvent.keyUp(slider, { key });
    }
    expect(sendAppEvent).toHaveBeenCalledTimes(8);
    expect(sendAppEvent).toHaveBeenNthCalledWith(8, {
      type: "listen_together.seek",
      room_slug: "room-1",
      positionMs: 50,
      entryId: "entry-1",
    });

    fireEvent.change(slider, { target: { value: "60" } });
    fireEvent.keyDown(slider, { key: "Escape" });
    expect(sendAppEvent).toHaveBeenCalledTimes(8);
  });

  it("does not send a pending seek with a successor entry", () => {
    const sendAppEvent = vi.fn(() => true);
    const playback = makePlaybackState();
    const { rerender } = render(
      <ListenTogetherNowPlayingCard
        playback={playback}
        sfu={{ voiceGW: { sendAppEvent } } as never}
        roomSlug="room-1"
        variant="mini"
      />,
    );

    const slider = screen.getByLabelText("Seek Track One");
    fireEvent.change(slider, { target: { value: "40" } });
    const successorEntry = {
      ...playback.currentEntry!,
      entryId: "entry-2",
      track: { ...playback.currentEntry!.track, title: "Track Two" },
    };
    const successorPlayback = {
      ...playback,
      currentEntry: successorEntry,
      snapshot: {
        ...playback.snapshot!,
        revision: 2,
        currentEntryId: successorEntry.entryId,
        currentEntry: successorEntry,
        queue: [successorEntry],
      },
    };
    rerender(
      <ListenTogetherNowPlayingCard
        playback={successorPlayback}
        sfu={{ voiceGW: { sendAppEvent } } as never}
        roomSlug="room-1"
        variant="mini"
      />,
    );

    fireEvent.pointerUp(screen.getByLabelText("Seek Track Two"));
    expect(sendAppEvent).not.toHaveBeenCalled();
  });

  it("starts a fresh seek for a successor entry after a mid-drag transition", () => {
    const sendAppEvent = vi.fn(() => true);
    const playback = makePlaybackState();
    const { rerender } = render(
      <ListenTogetherNowPlayingCard
        playback={playback}
        sfu={{ voiceGW: { sendAppEvent } } as never}
        roomSlug="room-1"
        variant="mini"
      />,
    );

    fireEvent.change(screen.getByLabelText("Seek Track One"), {
      target: { value: "40" },
    });
    const successorEntry = {
      ...playback.currentEntry!,
      entryId: "entry-2",
      track: { ...playback.currentEntry!.track, title: "Track Two" },
    };
    const successorPlayback = {
      ...playback,
      currentEntry: successorEntry,
      snapshot: {
        ...playback.snapshot!,
        revision: 2,
        currentEntryId: successorEntry.entryId,
        currentEntry: successorEntry,
        queue: [successorEntry],
      },
    };
    rerender(
      <ListenTogetherNowPlayingCard
        playback={successorPlayback}
        sfu={{ voiceGW: { sendAppEvent } } as never}
        roomSlug="room-1"
        variant="mini"
      />,
    );

    const successorSlider = screen.getByLabelText("Seek Track Two");
    fireEvent.change(successorSlider, { target: { value: "70" } });
    fireEvent.pointerUp(successorSlider);

    expect(sendAppEvent).toHaveBeenCalledWith({
      type: "listen_together.seek",
      room_slug: "room-1",
      positionMs: 70,
      entryId: "entry-2",
    });
  });

  it("restores the prior playback override when the seek send is rejected", () => {
    const priorPlayback = {
      paused: true,
      positionMs: 4_000,
      entryId: "entry-1",
      snapshotRevision: 1,
      source: "native" as const,
      accepted: true,
    };
    const playback = Object.assign(makePlaybackState(), {
      localPlayback: priorPlayback,
    }) as ListenTogetherPlaybackState;
    const sendAppEvent = vi.fn(() => false);

    render(
      <ListenTogetherNowPlayingCard
        playback={playback}
        sfu={{ voiceGW: { sendAppEvent } } as never}
        roomSlug="room-1"
        variant="panel"
      />,
    );

    const slider = screen.getByLabelText("Seek Track One");
    fireEvent.change(slider, { target: { value: "30" } });
    fireEvent.pointerUp(slider);

    expect(playback.setLocalPlayback).toHaveBeenLastCalledWith(
      "room-1",
      priorPlayback,
    );
  });

  it.each([
    ["cancelled", "pointerCancel"],
    ["rejected", "pointerUp"],
  ] as const)(
    "preserves a newer override when a %s seek finishes",
    (_label, finishEvent) => {
      const priorPlayback = {
        paused: true,
        positionMs: 4_000,
        entryId: "entry-1",
        snapshotRevision: 1,
        source: "native" as const,
        accepted: true,
      };
      const newerPlayback = {
        paused: false,
        positionMs: 8_000,
        entryId: "entry-1",
        snapshotRevision: 1,
        source: "command" as const,
        accepted: true,
      };
      const playback = Object.assign(makePlaybackState(), {
        localPlayback: priorPlayback,
      }) as ListenTogetherPlaybackState;
      const sendAppEvent = vi.fn(() => false);
      const { rerender } = render(
        <ListenTogetherNowPlayingCard
          playback={playback}
          sfu={{ voiceGW: { sendAppEvent } } as never}
          roomSlug="room-1"
          variant="panel"
        />,
      );

      const slider = screen.getByLabelText("Seek Track One");
      fireEvent.change(slider, { target: { value: "30" } });
      rerender(
        <ListenTogetherNowPlayingCard
          playback={{ ...playback, localPlayback: newerPlayback }}
          sfu={{ voiceGW: { sendAppEvent } } as never}
          roomSlug="room-1"
          variant="panel"
        />,
      );

      fireEvent[finishEvent](screen.getByLabelText("Seek Track One"));

      expect(playback.setLocalPlayback).toHaveBeenCalledTimes(1);
      expect(playback.setLocalPlayback).not.toHaveBeenLastCalledWith(
        "room-1",
        priorPlayback,
      );
      if (finishEvent === "pointerUp") {
        expect(sendAppEvent).toHaveBeenCalledTimes(1);
      }
    },
  );

  it("clears a seek preview when its saved override is older than the current snapshot", () => {
    const priorPlayback = {
      paused: true,
      positionMs: 4_000,
      entryId: "entry-1",
      snapshotRevision: 1,
      source: "command" as const,
      accepted: true,
    };
    const basePlayback = makePlaybackState();
    const playback = Object.assign(basePlayback, {
      localPlayback: priorPlayback,
      snapshot: { ...basePlayback.snapshot!, revision: 2 },
    }) as ListenTogetherPlaybackState;

    render(
      <ListenTogetherNowPlayingCard
        playback={playback}
        sfu={{ voiceGW: { sendAppEvent: vi.fn(() => true) } } as never}
        roomSlug="room-1"
        variant="mini"
      />,
    );

    const slider = screen.getByLabelText("Seek Track One");
    fireEvent.change(slider, { target: { value: "30" } });
    fireEvent.pointerCancel(slider);

    expect(playback.setLocalPlayback).toHaveBeenLastCalledWith("room-1", null);
  });

  it.each(["mini", "panel"] as const)(
    "does not send a seek command when %s pointer interaction is cancelled",
    (variant) => {
      const sendAppEvent = vi.fn(() => true);

      render(
        <ListenTogetherNowPlayingCard
          playback={makePlaybackState()}
          sfu={{ voiceGW: { sendAppEvent } } as never}
          roomSlug="room-1"
          variant={variant}
        />,
      );

      const slider = screen.getByLabelText("Seek Track One");
      fireEvent.change(slider, { target: { value: "30" } });
      fireEvent.pointerCancel(slider);

      expect(sendAppEvent).not.toHaveBeenCalled();
    },
  );

  it("allows the mini player seek control to shrink within its time row", () => {
    render(
      <ListenTogetherNowPlayingCard
        playback={makePlaybackState()}
        sfu={{ voiceGW: { sendAppEvent: vi.fn() } } as never}
        roomSlug="room-1"
        variant="mini"
      />,
    );

    expect(screen.getByLabelText("Seek Track One")).toHaveClass("min-w-0");
  });

  it("uses the semantic destructive color for an issue badge", () => {
    render(
      <ListenTogetherNowPlayingCard
        playback={makePlaybackState({
          error: { code: "PLAYBACK_ERROR", message: "Playback failed" },
        })}
        sfu={{ voiceGW: { sendAppEvent: vi.fn() } } as never}
        roomSlug="room-1"
        variant="mini"
      />,
    );

    expect(screen.getByText("Issue")).toHaveClass("text-destructive");
  });

  it("stays hidden in mini mode when nothing is currently playing", () => {
    const playback = makePlaybackState({
      currentEntry: null,
      snapshot: {
        roomSlug: "room-1",
        revision: 1,
        paused: true,
        currentEntryId: null,
        anchorPositionMs: 0,
        anchorUpdatedAt: 1_000,
        lastUpdatedAt: 1_000,
        queue: [],
        currentEntry: null,
        positionMs: 0,
        durationMs: null,
      },
      durationMs: 0,
      effectiveSeekValue: 0,
      progressMax: 1,
    });

    const { container } = render(
      <ListenTogetherNowPlayingCard
        playback={playback}
        sfu={null}
        roomSlug="room-1"
        variant="mini"
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
