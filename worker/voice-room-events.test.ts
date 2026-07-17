import { describe, expect, it } from "vitest";

import { sanitizeVoiceAppEvent } from "./voice-room-events";

describe("voice Wordle activity events", () => {
  const now = Date.parse("2026-06-09T12:00:00.000Z");

  it("leaves unknown event types for the existing rejection path", () => {
    expect(
      sanitizeVoiceAppEvent(
        { type: "arbitrary.event", secret: "must-not-broadcast" },
        "authenticated-user",
        "participant-1",
        now,
      ),
    ).toBeNull();
  });

  it("sanitizes activity starts and replaces spoofed sender identity", () => {
    expect(
      sanitizeVoiceAppEvent(
        {
          type: "activity.start",
          userId: "spoofed-user",
          channelId: " channel-1 ",
          activity: "wordle",
          startedAt: now,
          secret: "must-not-broadcast",
        },
        "authenticated-user",
        "participant-1",
        now,
      ),
    ).toEqual({
      kind: "activity.start",
      event: {
        type: "activity.start",
        userId: "authenticated-user",
        participant_id: "participant-1",
        channelId: "channel-1",
        activity: "wordle",
        startedAt: now,
      },
    });
  });

  it("sanitizes activity leaves and replaces spoofed sender identity", () => {
    expect(
      sanitizeVoiceAppEvent(
        {
          type: "activity.leave",
          userId: "spoofed-user",
          channelId: " channel-1 ",
          secret: "must-not-broadcast",
        },
        "authenticated-user",
        "participant-1",
        now,
      ),
    ).toEqual({
      kind: "activity.leave",
      event: {
        type: "activity.leave",
        userId: "authenticated-user",
        participant_id: "participant-1",
        channelId: "channel-1",
      },
    });
  });

  it.each([
    [
      {
        type: "activity.start",
        channelId: "channel-1",
        activity: "unknown",
        startedAt: now,
      },
    ],
    [
      {
        type: "activity.start",
        channelId: "x".repeat(201),
        activity: "wordle",
        startedAt: now,
      },
    ],
  ])("rejects malformed activity starts", (payload) => {
    expect(
      sanitizeVoiceAppEvent(
        payload,
        "authenticated-user",
        "participant-1",
        now,
      ),
    ).toEqual({ kind: "invalid", message: "Invalid activity.start payload" });
  });

  it.each([
    { type: "activity.leave", channelId: "" },
    { type: "activity.leave", channelId: "x".repeat(201) },
  ])("rejects malformed activity leaves", (payload) => {
    expect(
      sanitizeVoiceAppEvent(
        payload,
        "authenticated-user",
        "participant-1",
        now,
      ),
    ).toEqual({ kind: "invalid", message: "Invalid activity.leave payload" });
  });

  it.each([
    { guesses: Array.from({ length: 7 }, () => "crane") },
    { guesses: ["too-short"] },
    { guesses: ["crane"], name: "x".repeat(81) },
  ])("rejects malformed or oversized Wordle progress", (progress) => {
    expect(
      sanitizeVoiceAppEvent(
        {
          type: "wordle.progress",
          channel_id: "channel-1",
          puzzle_date: "2026-06-09",
          progress: {
            name: "Ada",
            avatar: null,
            streak: 1,
            finished: false,
            missed: false,
            ...progress,
          },
        },
        "authenticated-user",
        "participant-1",
        now,
      ),
    ).toEqual({ kind: "invalid", message: "Invalid wordle.progress payload" });
  });

  it("delivers one sanitized progress record for the authenticated sender", () => {
    expect(
      sanitizeVoiceAppEvent(
        {
          type: "wordle.progress",
          channel_id: " channel-1 ",
          puzzle_date: "2026-06-09",
          progress: {
            userId: "other-user",
            name: "Ada",
            avatar: "https://example.test/avatar.png",
            guesses: ["CRANE"],
            streak: 2,
            finished: false,
            missed: false,
            extra: "must-not-broadcast",
          },
        },
        "authenticated-user",
        "participant-1",
        now,
      ),
    ).toEqual({
      kind: "wordle.progress",
      event: {
        type: "wordle.progress",
        channel_id: "channel-1",
        puzzle_date: "2026-06-09",
        progress: {
          userId: "authenticated-user",
          participant_id: "participant-1",
          name: null,
          avatar: null,
          guesses: ["crane"],
          streak: 2,
          finished: false,
          missed: false,
        },
      },
    });
  });
});
