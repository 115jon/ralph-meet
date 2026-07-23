import { describe, expect, it } from "vitest";
import { getPersistentVoiceViewIdentity } from "./voice-session-view";

describe("getPersistentVoiceViewIdentity", () => {
  it("keeps a joined voice view identity when text navigation changes the active channel", () => {
    const voiceSession = {
      joined: true,
      activeServerId: "server-1",
      activeChannelId: "voice-1",
      voiceServerId: "server-1",
      voiceChannelId: "voice-1",
    };

    expect(getPersistentVoiceViewIdentity(voiceSession)).toEqual(
      getPersistentVoiceViewIdentity({
        ...voiceSession,
        activeChannelId: "general",
      }),
    );
  });

  it("follows the selected voice channel before a session is joined", () => {
    expect(
      getPersistentVoiceViewIdentity({
        joined: false,
        activeServerId: "server-1",
        activeChannelId: "voice-2",
        voiceServerId: "server-1",
        voiceChannelId: "voice-1",
      }),
    ).toEqual({
      key: "persistent-voice-session-server-1-voice-2",
      serverId: "server-1",
      channelId: "voice-2",
    });
  });
});
