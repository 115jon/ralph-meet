import { describe, expect, it, vi } from "vitest";
import {
  VoiceJoinGrantWaiters,
  createVoiceJoinGrantSequence,
  parseVoiceJoinGrantQuery,
  parseVoiceJoinGrantUpdate,
  serializeVoiceJoinGrantQuery,
  serializeVoiceJoinGrantUpdate,
} from "./voice-join-grant";

describe("voice join grant messages", () => {
  it("round-trips grant updates and queries", () => {
    const update = {
      participantId: "participant-1",
      subject: "user-1",
      granted: true,
      seq: 42,
    };
    expect(
      parseVoiceJoinGrantUpdate(
        JSON.parse(serializeVoiceJoinGrantUpdate(update)),
      ),
    ).toEqual(update);
    const query = { participantId: "participant-1", subject: "user-1" };
    expect(
      parseVoiceJoinGrantQuery(JSON.parse(serializeVoiceJoinGrantQuery(query))),
    ).toEqual(query);
  });

  it.each([
    null,
    {},
    { participant_id: "", subject: "user-1", granted: true, seq: 1 },
    { participant_id: "p", subject: "", granted: true, seq: 1 },
    { participant_id: "p", subject: "user-1", granted: "yes", seq: 1 },
    { participant_id: "p", subject: "user-1", granted: true, seq: -1 },
    { participant_id: "p", subject: "user-1", granted: true, seq: 1.5 },
    { participant_id: "p".repeat(513), subject: "u", granted: true, seq: 1 },
  ])("rejects a malformed grant update: %j", (value) => {
    expect(parseVoiceJoinGrantUpdate(value)).toBeNull();
  });

  it("issues strictly increasing sequence numbers even when the clock stalls", () => {
    let now = 1_000;
    const next = createVoiceJoinGrantSequence(() => now);
    expect(next()).toBe(1_000);
    expect(next()).toBe(1_001);
    now = 900;
    expect(next()).toBe(1_002);
    now = 5_000;
    expect(next()).toBe(5_000);
  });
});

describe("voice join grant waiters", () => {
  it("answers immediately when the verdict is already known", async () => {
    const waiters = new VoiceJoinGrantWaiters();
    await expect(waiters.wait("p", 1_000, () => true)).resolves.toBe(true);
    await expect(waiters.wait("p", 1_000, () => false)).resolves.toBe(false);
  });

  it("resolves on the notification that settles the verdict", async () => {
    const waiters = new VoiceJoinGrantWaiters();
    let state: boolean | null = null;
    const result = waiters.wait("p", 10_000, () => state);
    waiters.notify("p");
    state = true;
    waiters.notify("other");
    waiters.notify("p");
    await expect(result).resolves.toBe(true);
  });

  it("refuses at the deadline when no verdict arrives", async () => {
    vi.useFakeTimers();
    try {
      const waiters = new VoiceJoinGrantWaiters();
      const result = waiters.wait("p", 500, (final) => (final ? false : null));
      await vi.advanceTimersByTimeAsync(500);
      await expect(result).resolves.toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
