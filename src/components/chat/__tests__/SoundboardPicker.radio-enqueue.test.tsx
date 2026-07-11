/**
 * @vitest-environment jsdom
 */
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SoundboardPicker from "../SoundboardPicker";
import type { SFUClient } from "@/lib/sfu-client";
import type { ListenTogetherEnqueueCommand } from "@/lib/listen-together";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/api-client", () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiUpload: vi.fn(),
  apiDelete: vi.fn(),
  apiPatch: vi.fn(),
}));

vi.mock("@/stores/chat-store", () => ({
  useChatStore: {
    getState: () => ({
      user: {
        id: "user-1",
        username: "testuser",
        display_name: "Test User",
        avatar_url: null,
        avatar_display: null,
      },
    }),
  },
}));

describe("SoundboardPicker - Radio Enqueue", () => {
  let mockSfu: SFUClient;

  beforeEach(async () => {
    vi.clearAllMocks();

    const { apiGet } = await import("@/lib/api-client");
    vi.mocked(apiGet).mockImplementation((path) => {
      if (path === "/api/myinstants/favorites") {
        return Promise.resolve({ favorites: [] });
      }
      return Promise.resolve([]);
    });

    mockSfu = {
      on: vi.fn(() => vi.fn()),
      voiceGW: {
        sendAppEvent: vi.fn(),
      },
    } as unknown as SFUClient;

    global.fetch = vi.fn(() =>
      Promise.resolve({
        json: () =>
          Promise.resolve([
            {
              stationuuid: "station-1",
              name: "Test Radio Station",
              url_resolved: "https://stream.example.com/radio",
              favicon: "https://example.com/icon.png",
              tags: "rock,indie",
              clickcount: 1000,
            },
          ]),
      } as Response),
    );
  });

  it("should enqueue radio as a station UUID without a stream URL", async () => {
    const user = userEvent.setup();

    render(
      <SoundboardPicker
        onClose={vi.fn()}
        sfu={mockSfu}
        serverId="server-1"
        channelId="channel-1"
        roomSlug="room-1"
        voiceSessionId="session-1"
        localUserId="user-1"
      />,
    );

    // Navigate to Radio view - find button by tooltip content
    const radioButton = screen.getByRole("button", { name: /radio/i });
    await user.click(radioButton);

    // Wait for radio stations to load
    await waitFor(() => {
      expect(screen.getByText("Test Radio Station")).toBeInTheDocument();
    });

    // Click on radio station - find the parent button
    const stationButton = screen.getByLabelText("Play Test Radio Station");
    await user.click(stationButton);

    // Verify listen_together.enqueue was called with radio entry
    await waitFor(() => {
      expect(mockSfu.voiceGW.sendAppEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "listen_together.enqueue",
          room_slug: "room-1",
          mode: "append",
          entries: expect.arrayContaining([
            expect.objectContaining({
              track: expect.objectContaining({
                kind: "radio",
                provider: "radio",
                title: "Test Radio Station",
                station_uuid: "station-1",
              }),
              requester: expect.objectContaining({
                userId: "user-1",
              }),
            }),
          ]),
        }),
      );
    });

    // Verify soundboard.play was NOT called
    expect(mockSfu.voiceGW.sendAppEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "soundboard.play",
      }),
    );
  });

  it("should preserve only client display metadata in the radio enqueue payload", async () => {
    const user = userEvent.setup();

    render(
      <SoundboardPicker
        onClose={vi.fn()}
        sfu={mockSfu}
        serverId="server-1"
        channelId="channel-1"
        roomSlug="room-1"
        voiceSessionId="session-1"
        localUserId="user-1"
      />,
    );

    const radioButton = screen.getByRole("button", { name: /radio/i });
    await user.click(radioButton);

    await waitFor(() => {
      expect(screen.getByText("Test Radio Station")).toBeInTheDocument();
    });

    const stationButton = screen.getByLabelText("Play Test Radio Station");
    await user.click(stationButton);

    await waitFor(() => {
      const calls = vi.mocked(mockSfu.voiceGW.sendAppEvent).mock.calls;
      const call = calls.find((c) => c[0]?.type === "listen_together.enqueue");
      expect(call).toBeDefined();
      const payload = call![0] as unknown as ListenTogetherEnqueueCommand;
      const entry = payload.entries[0];
      expect(entry.track).toMatchObject({
        kind: "radio",
        provider: "radio",
        title: "Test Radio Station",
        station_uuid: "station-1",
      });
      expect(entry.track).not.toHaveProperty("streamUrl");
      expect(entry.track).not.toHaveProperty("canonicalUrl");
      expect(entry.requester).toMatchObject({
        userId: "user-1",
        displayName: expect.any(String),
      });
    });
  });

  it("merges metadata-only server catalog updates into the existing sound", async () => {
    let onAppEvent: ((event: unknown) => void) | undefined;
    const { apiGet } = await import("@/lib/api-client");
    vi.mocked(apiGet).mockImplementation((path) => {
      if (path === "/api/myinstants/favorites")
        return Promise.resolve({ favorites: [] });
      if (path === "/api/servers/server-1/soundboard") {
        return Promise.resolve([
          {
            id: "sound-1",
            name: "Airhorn",
            file_url: "https://cdn.example.com/airhorn.mp3",
            emoji: "!",
            volume: 0.5,
          },
        ]);
      }
      return Promise.resolve([]);
    });
    mockSfu.on = vi.fn((_name, handler) => {
      onAppEvent = handler as (event: unknown) => void;
      return vi.fn();
    });

    render(
      <SoundboardPicker
        onClose={vi.fn()}
        sfu={mockSfu}
        serverId="server-1"
        channelId="channel-1"
      />,
    );

    await waitFor(() =>
      expect(screen.getByLabelText("Play Airhorn")).toBeInTheDocument(),
    );
    act(() => {
      onAppEvent?.({
        type: "soundboard.catalog-updated",
        server_key: "server-1",
        sound: {
          id: "sound-1",
          name: "Siren",
          emoji: "\ud83d\udea8",
          volume: 0.8,
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByLabelText("Play Siren")).toBeInTheDocument();
      expect(screen.queryByLabelText("Play Airhorn")).not.toBeInTheDocument();
    });
  });
});
