/**
 * @vitest-environment jsdom
 */
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SoundboardPicker from "../SoundboardPicker";
import type { SFUClient } from "@/lib/sfu-client";
import type { ListenTogetherEnqueueCommand } from "@/lib/listen-together";
import { useListenTogetherStore } from "@/stores/useListenTogetherStore";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/api-client", () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiUpload: vi.fn(),
  apiDelete: vi.fn(),
  apiPatch: vi.fn(),
}));

vi.mock("@/stores/chat-store", () => {
  const useChatStore = (selector: (state: unknown) => unknown) =>
    selector({ servers: [] });
  useChatStore.getState = () => ({
    user: {
      id: "user-1",
      username: "testuser",
      display_name: "Test User",
      avatar_url: null,
      avatar_display: null,
    },
  });
  return { useChatStore };
});

describe("SoundboardPicker - Radio Enqueue", () => {
  let mockSfu: SFUClient;

  beforeEach(async () => {
    vi.clearAllMocks();
    useListenTogetherStore.setState({ rooms: {} });

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

  it("shows a shared room error and clears it with a successful retry", async () => {
    const user = userEvent.setup();
    const sendAppEvent = vi
      .fn()
      .mockReturnValueOnce(false)
      .mockReturnValue(true);
    mockSfu.voiceGW.sendAppEvent = sendAppEvent as never;

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

    await user.click(screen.getByRole("button", { name: /radio/i }));
    await waitFor(() =>
      expect(screen.getByText("Test Radio Station")).toBeInTheDocument(),
    );

    await user.click(screen.getByLabelText("Play Test Radio Station"));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not enqueue the radio station",
    );

    act(() => {
      useListenTogetherStore.getState().setError("room-1", {
        code: "RADIO_UNAVAILABLE",
        message: "The radio station is unavailable.",
      });
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The radio station is unavailable.",
    );

    await user.click(screen.getByLabelText("Play Test Radio Station"));
    await waitFor(() => {
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(
        useListenTogetherStore.getState().rooms["room-1"]?.error,
      ).toBeNull();
    });
  });

  it("shows feedback instead of falling through when radio has no voice room", async () => {
    const user = userEvent.setup();

    render(
      <SoundboardPicker
        onClose={vi.fn()}
        sfu={null}
        serverId="server-1"
        channelId="channel-1"
        roomSlug="room-1"
        voiceSessionId="session-1"
        localUserId="user-1"
      />,
    );

    await user.click(screen.getByRole("button", { name: /radio/i }));
    await waitFor(() =>
      expect(screen.getByText("Test Radio Station")).toBeInTheDocument(),
    );

    await user.click(screen.getByLabelText("Play Test Radio Station"));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Connect to the voice room before playing radio.",
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

  it("shows a visible error when the gateway rejects a radio enqueue", async () => {
    const user = userEvent.setup();
    mockSfu.voiceGW.sendAppEvent = vi.fn(() => false) as never;

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

    await user.click(screen.getByRole("button", { name: /radio/i }));
    await waitFor(() =>
      expect(screen.getByText("Test Radio Station")).toBeInTheDocument(),
    );
    await user.click(screen.getByLabelText("Play Test Radio Station"));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not enqueue the radio station",
    );
  });

  it("clears a radio enqueue error after a later accepted retry", async () => {
    const user = userEvent.setup();
    const sendAppEvent = vi
      .fn()
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    mockSfu.voiceGW.sendAppEvent = sendAppEvent as never;

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

    await user.click(screen.getByRole("button", { name: /radio/i }));
    await waitFor(() =>
      expect(screen.getByText("Test Radio Station")).toBeInTheDocument(),
    );
    const stationButton = screen.getByLabelText("Play Test Radio Station");
    await user.click(stationButton);
    expect(screen.getByRole("alert")).toBeInTheDocument();

    await user.click(stationButton);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each(["network failure", "non-OK response"] as const)(
    "clears radio results and loading state after a %s",
    async (failureMode) => {
      const initialStation = {
        stationuuid: "station-1",
        name: "Initial Station",
        url_resolved: "https://stream.example.com/initial",
        favicon: "",
        tags: "rock",
        clickcount: 100,
      };
      const failedStation = {
        ...initialStation,
        stationuuid: "station-failed",
        name: "Unexpected Failed Response Station",
      };
      let fetchCount = 0;
      global.fetch = vi.fn(() => {
        fetchCount += 1;
        if (fetchCount === 1) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve([initialStation]),
          } as Response);
        }
        if (failureMode === "network failure") {
          return Promise.reject(new Error("radio browser unavailable"));
        }
        return Promise.resolve({
          ok: false,
          status: 503,
          json: () => Promise.resolve([failedStation]),
        } as Response);
      });
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

      await user.click(screen.getByRole("button", { name: /radio/i }));
      await waitFor(() =>
        expect(screen.getByText("Initial Station")).toBeInTheDocument(),
      );

      fireEvent.change(screen.getByLabelText("Search radio stations"), {
        target: { value: "jazz" },
      });

      await waitFor(
        () => {
          expect(screen.queryByText("Initial Station")).not.toBeInTheDocument();
          expect(
            screen.queryByText("Unexpected Failed Response Station"),
          ).not.toBeInTheDocument();
          expect(
            screen.getByText('No stations found for "jazz"'),
          ).toBeInTheDocument();
        },
        { timeout: 2_000 },
      );
    },
  );

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
