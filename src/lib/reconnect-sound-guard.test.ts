import type { Message } from "@/lib/types";
import { afterEach, describe, expect, it } from "vitest";
import {
  __resetReconnectSoundGuardForTests,
  areReconnectSoundsSuppressed,
  beginReconnectSoundSuppression,
  getVoiceChannelPresenceSound,
  shouldPlayCurrentChannelMessageSound,
} from "./reconnect-sound-guard";

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "msg-1",
    channel_id: "ch-1",
    author_id: "user-1",
    content: "hello",
    is_pinned: false,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

afterEach(() => {
  __resetReconnectSoundGuardForTests();
});

describe("reconnect sound guard", () => {
  it("suppresses sounds until the reconnect reload finishes", () => {
    const release = beginReconnectSoundSuppression();

    expect(areReconnectSoundsSuppressed()).toBe(true);

    release();

    expect(areReconnectSoundsSuppressed()).toBe(false);
  });

  it("detects a remote voice-channel join while you stay in the channel", () => {
    const sound = getVoiceChannelPresenceSound(
      [{ clerk_user_id: "me", name: "Me" } as any],
      [
        { clerk_user_id: "me", name: "Me" } as any,
        { clerk_user_id: "them", name: "Them" } as any,
      ],
      "me",
    );

    expect(sound).toBe("join");
  });

  it("detects a remote voice-channel leave while you stay in the channel", () => {
    const sound = getVoiceChannelPresenceSound(
      [
        { clerk_user_id: "me", name: "Me" } as any,
        { clerk_user_id: "them", name: "Them" } as any,
      ],
      [{ clerk_user_id: "me", name: "Me" } as any],
      "me",
    );

    expect(sound).toBe("leave");
  });

  it("ignores voice-channel diffs when you are not in that channel", () => {
    const sound = getVoiceChannelPresenceSound(
      [{ clerk_user_id: "them", name: "Them" } as any],
      [{ clerk_user_id: "them", name: "Them" } as any],
      "me",
    );

    expect(sound).toBeNull();
  });

  it("plays the current-channel message sound only for appended remote messages", () => {
    const previous = [makeMessage({ id: "msg-1" })];
    const next = [
      makeMessage({ id: "msg-1" }),
      makeMessage({ id: "msg-2", author_id: "user-2" }),
    ];

    expect(shouldPlayCurrentChannelMessageSound(previous, next, "user-1")).toBe(true);
  });

  it("does not treat a reconnect replacement as a new live message", () => {
    const previous = [makeMessage({ id: "msg-1" })];
    const next = [
      makeMessage({ id: "msg-9", author_id: "user-2" }),
      makeMessage({ id: "msg-10", author_id: "user-2" }),
    ];

    expect(shouldPlayCurrentChannelMessageSound(previous, next, "user-1")).toBe(false);
  });

  it("does not play for your own appended messages", () => {
    const previous = [makeMessage({ id: "msg-1" })];
    const next = [
      makeMessage({ id: "msg-1" }),
      makeMessage({ id: "msg-2", author_id: "user-1" }),
    ];

    expect(shouldPlayCurrentChannelMessageSound(previous, next, "user-1")).toBe(false);
  });
});
