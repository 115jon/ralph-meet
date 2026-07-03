import { describe, expect, it, vi } from "vitest";

import { applyRtcRoomControlDisconnectEffects } from "./rtc-room-control-disconnect-effects";

describe("rtc-room-control-disconnect-effects", () => {
  it("broadcasts offline and leave for an intentional shared disconnect", () => {
    const ws = {} as WebSocket;
    const adapter = {
      hasConcurrentControlSession: vi.fn(() => false),
      broadcast: vi.fn(),
      buildVoiceState: vi.fn(() => ({ id: "participant-1" })),
      cleanupChannelSubscriptions: vi.fn(),
      cleanupServerSubscriptions: vi.fn(),
      deleteLiveControlSession: vi.fn(),
      clearResumableControlState: vi.fn(),
      closeSocket: vi.fn(),
    };

    const applied = applyRtcRoomControlDisconnectEffects(
      adapter,
      ws,
      {
        id: "participant-1",
        clerk_user_id: "user-1",
        name: "Alice",
        self_mute: false,
        self_deaf: false,
        self_stream: false,
        self_video: false,
        suppress: false,
        tracks: [],
      },
      {
        intentional: true,
        closeSocket: true,
        closeCode: 1000,
        closeReason: "Left room",
      },
    );

    expect(applied).toBe(true);
    expect(adapter.broadcast).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        op: 19,
        d: {
          event: "PRESENCE_UPDATE",
          data: { user_id: "user-1", status: "offline" },
        },
      }),
      ws,
    );
    expect(adapter.buildVoiceState).toHaveBeenCalledWith(
      expect.objectContaining({ id: "participant-1" }),
    );
    expect(adapter.broadcast).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        op: 15,
        d: {
          participant: { id: "participant-1" },
          action: "leave",
        },
      }),
      ws,
    );
    expect(adapter.cleanupChannelSubscriptions).toHaveBeenCalledWith(ws);
    expect(adapter.cleanupServerSubscriptions).toHaveBeenCalledWith(ws);
    expect(adapter.deleteLiveControlSession).toHaveBeenCalledWith(ws, "participant-1");
    expect(adapter.clearResumableControlState).toHaveBeenCalledWith("participant-1");
    expect(adapter.closeSocket).toHaveBeenCalledWith(ws, 1000, "Left room");
  });

  it("skips offline presence when another shared control session remains", () => {
    const ws = {} as WebSocket;
    const adapter = {
      hasConcurrentControlSession: vi.fn(() => true),
      broadcast: vi.fn(),
      buildVoiceState: vi.fn(() => ({ id: "participant-1" })),
      cleanupChannelSubscriptions: vi.fn(),
      cleanupServerSubscriptions: vi.fn(),
      deleteLiveControlSession: vi.fn(),
      clearResumableControlState: vi.fn(),
      closeSocket: vi.fn(),
    };

    applyRtcRoomControlDisconnectEffects(
      adapter,
      ws,
      {
        id: "participant-1",
        clerk_user_id: "user-1",
        name: "Alice",
        self_mute: false,
        self_deaf: false,
        self_stream: false,
        self_video: false,
        suppress: false,
        tracks: [],
      },
      {
        intentional: false,
        closeSocket: false,
      },
    );

    expect(adapter.broadcast).not.toHaveBeenCalled();
    expect(adapter.buildVoiceState).not.toHaveBeenCalled();
    expect(adapter.closeSocket).not.toHaveBeenCalled();
    expect(adapter.deleteLiveControlSession).toHaveBeenCalledWith(ws, "participant-1");
    expect(adapter.clearResumableControlState).toHaveBeenCalledWith("participant-1");
  });
});

