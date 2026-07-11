/**
 * @vitest-environment jsdom
 */
import { render } from "@testing-library/react";
import { VoiceMediaManager } from "../VoiceMediaManager";
import type { SFUClient } from "@/lib/sfu-client";
import { beforeEach, describe, it, expect, vi } from "vitest";

const voiceListenTogetherManagerSpy = vi.fn();
const voiceSoundboardManagerSpy = vi.fn();

vi.mock("../VoiceListenTogetherManager", () => ({
  VoiceListenTogetherManager: (props: {
    serverId?: string | null;
    channelId?: string | null;
  }) => {
    voiceListenTogetherManagerSpy(props);
    return null;
  },
}));

vi.mock("../VoiceSoundboardManager", () => ({
  VoiceSoundboardManager: (props: { serverId?: string | null }) => {
    voiceSoundboardManagerSpy(props);
    return null;
  },
}));

describe("VoiceMediaManager", () => {
  beforeEach(() => {
    voiceListenTogetherManagerSpy.mockClear();
    voiceSoundboardManagerSpy.mockClear();
  });
  it("uses the dm-call namespace for both media managers", () => {
    render(
      <VoiceMediaManager
        sfu={null}
        serverId={null}
        channelId="dm-channel"
        roomSlug="dm-room"
      />,
    );

    expect(voiceListenTogetherManagerSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ serverId: null }),
    );
    expect(voiceSoundboardManagerSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ serverId: null }),
    );
  });

  it("renders both VoiceListenTogetherManager and VoiceSoundboardManager", () => {
    const mockSfu = {
      on: vi.fn(() => vi.fn()),
      voiceGW: {
        sendAppEvent: vi.fn(),
      },
    } as unknown as SFUClient;

    const { container } = render(
      <VoiceMediaManager
        sfu={mockSfu}
        serverId="server-1"
        channelId="channel-1"
        roomSlug="room-slug-1"
        voiceSessionId="session-1"
        localUserId="user-1"
      />,
    );

    // Both managers render null but should be mounted
    expect(container).toBeInTheDocument();
  });

  it("passes sfu and metadata to child managers", () => {
    const mockSfu = {
      on: vi.fn(() => vi.fn()),
      voiceGW: {
        sendAppEvent: vi.fn(),
      },
    } as unknown as SFUClient;

    const { rerender } = render(
      <VoiceMediaManager
        sfu={mockSfu}
        serverId="server-1"
        channelId="channel-1"
        roomSlug="room-slug-1"
        voiceSessionId="session-1"
        localUserId="user-1"
      />,
    );

    // Should not throw with null sfu
    rerender(
      <VoiceMediaManager
        sfu={null}
        serverId="server-1"
        channelId="channel-1"
        roomSlug="room-slug-1"
        voiceSessionId="session-1"
        localUserId="user-1"
      />,
    );

    expect(voiceListenTogetherManagerSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ sfu: null, serverId: "server-1" }),
    );
  });
});
