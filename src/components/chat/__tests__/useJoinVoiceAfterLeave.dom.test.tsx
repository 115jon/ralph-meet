// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  useJoinVoiceAfterLeave,
  VOICE_SWITCH_JOIN_TIMEOUT_MS,
} from "../useJoinVoiceAfterLeave";

describe("useJoinVoiceAfterLeave", () => {
  const joinChannel = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    joinChannel.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  function setup(voiceJoined: boolean, activeChannelId = "vc-b") {
    return renderHook(
      (props: { voiceJoined: boolean; activeChannelId: string | null }) =>
        useJoinVoiceAfterLeave({
          activeChannelId: props.activeChannelId,
          voiceJoined: props.voiceJoined,
          joinChannel,
        }),
      { initialProps: { voiceJoined, activeChannelId } },
    );
  }

  it("joins the target only once the old session has left", () => {
    // The leave reports itself (onLeft) after the leave sound's send window,
    // and that report clears any auto-join flag set before it.
    const hook = setup(true);
    act(() => hook.result.current("vc-b"));
    expect(joinChannel).not.toHaveBeenCalled();

    hook.rerender({ voiceJoined: false, activeChannelId: "vc-b" });
    expect(joinChannel).toHaveBeenCalledTimes(1);
    expect(joinChannel).toHaveBeenCalledWith("vc-b");

    hook.rerender({ voiceJoined: false, activeChannelId: "vc-b" });
    expect(joinChannel).toHaveBeenCalledTimes(1);
  });

  it("joins at once when no voice channel session is joined (a call)", () => {
    const hook = setup(false);
    act(() => hook.result.current("vc-b"));
    expect(joinChannel).toHaveBeenCalledWith("vc-b");
  });

  it("drops the join when the user went elsewhere before the leave ended", () => {
    const hook = setup(true);
    act(() => hook.result.current("vc-b"));
    hook.rerender({ voiceJoined: true, activeChannelId: "text-1" });
    hook.rerender({ voiceJoined: false, activeChannelId: "text-1" });
    expect(joinChannel).not.toHaveBeenCalled();

    hook.rerender({ voiceJoined: false, activeChannelId: "vc-b" });
    expect(joinChannel).not.toHaveBeenCalled();
  });

  it("drops a join whose leave never finishes", () => {
    const hook = setup(true);
    act(() => hook.result.current("vc-b"));
    act(() => vi.advanceTimersByTime(VOICE_SWITCH_JOIN_TIMEOUT_MS));

    hook.rerender({ voiceJoined: false, activeChannelId: "vc-b" });
    expect(joinChannel).not.toHaveBeenCalled();
  });
});
