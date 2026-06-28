import { describe, expect, it } from "vitest";

import {
  getNextVoicePresenceAlarmTime,
  isVoiceMemberReconnecting,
  refreshVoiceMemberIdentity,
  shouldShowVoiceMemberStreamState,
} from "@/lib/voice-presence";

describe("voice presence helpers", () => {
  it("treats reconnecting members as disconnected-but-resumable", () => {
    expect(isVoiceMemberReconnecting({ connection_state: "reconnecting", connected: false })).toBe(true);
    expect(isVoiceMemberReconnecting({ connection_state: "connected", connected: true })).toBe(false);
  });

  it("schedules the next alarm for the earliest voice grace deadline", () => {
    const now = 1_000;

    expect(getNextVoicePresenceAlarmTime(now, 300_000, [now + 120_000, now + 30_000])).toBe(now + 30_000);
  });

  it("schedules overdue voice grace deadlines immediately", () => {
    const now = 10_000;

    expect(getNextVoicePresenceAlarmTime(now, 300_000, [now - 1])).toBe(now);
  });

  it("preserves reconnecting state when refreshing a stale member identity", () => {
    const member = refreshVoiceMemberIdentity(
      {
        clerk_user_id: "u1",
        name: "Old Name",
        connected: false,
        connection_state: "reconnecting" as const,
        disconnected_at: 1_000,
        reconnect_expires_at: 121_000,
      },
      {
        name: "New Name",
        username: "new-name",
        display_name: "New Display",
        avatar_url: "/new-avatar.png",
      },
    );

    expect(member).toMatchObject({
      name: "New Name",
      username: "new-name",
      display_name: "New Display",
      avatar_url: "/new-avatar.png",
      connected: false,
      connection_state: "reconnecting",
      disconnected_at: 1_000,
      reconnect_expires_at: 121_000,
    });
  });

  it("hides stream state for stale local memberships when this client is not actually in voice", () => {
    expect(shouldShowVoiceMemberStreamState(
      {
        self_stream: true,
        connected: true,
        connection_state: "connected",
      },
      {
        isCurrentUser: true,
        isCurrentClientVoiceConnected: false,
      },
    )).toBe(false);

    expect(shouldShowVoiceMemberStreamState(
      {
        self_stream: true,
        connected: true,
        connection_state: "connected",
      },
      {
        isCurrentUser: true,
        isCurrentClientVoiceConnected: true,
      },
    )).toBe(true);
  });
});
