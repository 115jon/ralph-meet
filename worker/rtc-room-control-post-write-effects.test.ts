import { describe, expect, it, vi } from "vitest";
import {
  applyRtcRoomChannelSubscribe,
  applyRtcRoomChannelUnsubscribe,
  applyRtcRoomPresenceUpdate,
  applyRtcRoomServerSubscribe,
  type RtcRoomControlPostWriteEffectsAdapter,
} from "./rtc-room-control-post-write-effects";

function createPostWriteAdapter(
  overrides: Partial<RtcRoomControlPostWriteEffectsAdapter> = {},
): RtcRoomControlPostWriteEffectsAdapter {
  return {
    queuePresenceWrite: vi.fn(),
    broadcastPresenceStatus: vi.fn(),
    addChannelSubscription: vi.fn(),
    removeChannelSubscription: vi.fn(),
    addServerSubscription: vi.fn(),
    sendPresenceList: vi.fn(),
    queueVoiceChannelStates: vi.fn(),
    logInfo: vi.fn(),
    ...overrides,
  };
}

describe("rtc-room-control-post-write-effects", () => {
  it("queues and broadcasts presence updates only when a clerk user id exists", () => {
    const ws = {} as WebSocket;
    const adapter = createPostWriteAdapter();
    const session = { name: "Alice", clerk_user_id: "user-1" };

    const applied = applyRtcRoomPresenceUpdate(adapter, session, "idle");

    expect(applied).toBe(true);
    expect(adapter.queuePresenceWrite).toHaveBeenCalledWith("user-1", "idle");
    expect(adapter.broadcastPresenceStatus).toHaveBeenCalledWith("user-1", "idle");
  });

  it("skips presence updates when the socket session is not a user session", () => {
    const adapter = createPostWriteAdapter();

    const applied = applyRtcRoomPresenceUpdate(adapter, { name: "Anonymous" }, "idle");

    expect(applied).toBe(false);
    expect(adapter.queuePresenceWrite).not.toHaveBeenCalled();
    expect(adapter.broadcastPresenceStatus).not.toHaveBeenCalled();
  });

  it("adds a channel subscription, snapshots presence, and queues voice state fanout", () => {
    const ws = {} as WebSocket;
    const adapter = createPostWriteAdapter();
    const session = { name: "Alice", clerk_user_id: "user-1" };
    const onlineClerkUserIds = ["user-1", "user-2"];

    const applied = applyRtcRoomChannelSubscribe(
      adapter,
      ws,
      session,
      { channel_id: "channel-1" },
      onlineClerkUserIds,
    );

    expect(applied).toBe(true);
    expect(adapter.addChannelSubscription).toHaveBeenCalledWith("channel-1", ws);
    expect(adapter.sendPresenceList).toHaveBeenCalledWith(ws, onlineClerkUserIds);
    expect(adapter.queueVoiceChannelStates).toHaveBeenCalledWith(ws, "user-1");
    expect(adapter.logInfo).toHaveBeenCalledWith("Alice subscribed to channel channel-1");
  });

  it("uses the supplied online user list rather than recomputing one from adapter state", () => {
    const ws = {} as WebSocket;
    const adapter = createPostWriteAdapter();
    const session = { name: "Alice", clerk_user_id: "user-1" };

    applyRtcRoomChannelSubscribe(
      adapter,
      ws,
      session,
      { channel_id: "channel-1" },
      ["user-authoritative"],
    );

    expect(adapter.sendPresenceList).toHaveBeenCalledWith(ws, ["user-authoritative"]);
  });

  it("skips queueing voice-channel state bootstrap when the subscribing session has no clerk user id", () => {
    const ws = {} as WebSocket;
    const adapter = createPostWriteAdapter();

    const applied = applyRtcRoomChannelSubscribe(
      adapter,
      ws,
      { name: "Anonymous" },
      { channel_id: "channel-1" },
      ["user-authoritative"],
    );

    expect(applied).toBe(true);
    expect(adapter.queueVoiceChannelStates).not.toHaveBeenCalled();
  });

  it("removes a channel subscription without replaying other side effects", () => {
    const ws = {} as WebSocket;
    const adapter = createPostWriteAdapter();
    const session = { name: "Alice", clerk_user_id: "user-1" };

    const applied = applyRtcRoomChannelUnsubscribe(adapter, ws, session, { channel_id: "channel-1" });

    expect(applied).toBe(true);
    expect(adapter.removeChannelSubscription).toHaveBeenCalledWith("channel-1", ws);
    expect(adapter.sendPresenceList).not.toHaveBeenCalled();
    expect(adapter.queueVoiceChannelStates).not.toHaveBeenCalled();
  });

  it("adds a server subscription only for identified user sessions", () => {
    const ws = {} as WebSocket;
    const adapter = createPostWriteAdapter();
    const session = { name: "Alice", clerk_user_id: "user-1" };

    const applied = applyRtcRoomServerSubscribe(adapter, ws, session, { server_id: "server-1" });

    expect(applied).toBe(true);
    expect(adapter.addServerSubscription).toHaveBeenCalledWith("server-1", ws);
    expect(adapter.logInfo).toHaveBeenCalledWith("Alice subscribed to server server-1");
  });

  it("skips server subscription effects when the user identity is missing", () => {
    const ws = {} as WebSocket;
    const adapter = createPostWriteAdapter();

    const applied = applyRtcRoomServerSubscribe(adapter, ws, { name: "Alice" }, { server_id: "server-1" });

    expect(applied).toBe(false);
    expect(adapter.addServerSubscription).not.toHaveBeenCalled();
    expect(adapter.logInfo).not.toHaveBeenCalled();
  });
});
