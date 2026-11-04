// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { VOICE_MOVE_EVENT } from "@/lib/voice/voice-move-client";

import { useFollowVoiceMove } from "../useFollowVoiceMove";

function move(serverId: string, channelId: string) {
  const event = new CustomEvent(VOICE_MOVE_EVENT, {
    detail: { serverId, channelId },
    cancelable: true,
  });
  window.dispatchEvent(event);
  return event;
}

describe("useFollowVoiceMove", () => {
  const calls: string[] = [];
  const disconnect = vi.fn(() => calls.push("disconnect"));
  const switchServer = vi.fn((serverId: string) =>
    calls.push(`switch:${serverId}`),
  );
  const joinChannel = vi.fn((channelId: string) =>
    calls.push(`join:${channelId}`),
  );

  beforeEach(() => {
    vi.useFakeTimers();
    calls.length = 0;
    disconnect.mockClear();
    switchServer.mockClear();
    joinChannel.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  function setup(voiceJoined: boolean, activeServerId = "srv-1") {
    return renderHook(
      (props: { voiceJoined: boolean; activeServerId: string }) =>
        useFollowVoiceMove({
          activeServerId: props.activeServerId,
          channelIds: ["vc-a", "vc-b"],
          voiceJoined: props.voiceJoined,
          disconnect,
          switchServer,
          joinChannel,
        }),
      { initialProps: { voiceJoined, activeServerId } },
    );
  }

  it("never joins before the old session's leave, even mid-connect", () => {
    // A move while the join is still connecting: `joined` is already false.
    setup(false);
    const fired: { event?: CustomEvent } = {};
    act(() => {
      fired.event = move("srv-1", "vc-b");
    });
    expect(fired.event?.defaultPrevented).toBe(true);
    expect(calls).toEqual([]);

    act(() => vi.advanceTimersByTime(1));
    expect(calls).toEqual(["disconnect", "join:vc-b"]);
  });

  it("waits for the joined session to finish leaving", () => {
    const hook = setup(true);
    act(() => move("srv-1", "vc-b"));
    act(() => vi.advanceTimersByTime(1));
    expect(calls).toEqual(["disconnect"]);

    hook.rerender({ voiceJoined: false, activeServerId: "srv-1" });
    expect(calls).toEqual(["disconnect", "join:vc-b"]);
  });

  it("switches server first when the move is elsewhere", () => {
    const hook = setup(false, "srv-other");
    act(() => move("srv-1", "vc-b"));
    act(() => vi.advanceTimersByTime(1));
    expect(calls).toEqual(["disconnect", "switch:srv-1"]);

    hook.rerender({ voiceJoined: false, activeServerId: "srv-1" });
    expect(calls).toEqual(["disconnect", "switch:srv-1", "join:vc-b"]);
  });
});
