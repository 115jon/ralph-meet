// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLayoutEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn() }));

vi.mock("@/lib/api-client", () => ({
  apiGet: mocks.apiGet,
  apiPost: mocks.apiPost,
  apiUpload: vi.fn(),
  apiDelete: vi.fn(),
  apiPatch: vi.fn(),
}));

import SoundboardPicker from "@/components/chat/SoundboardPicker";
import type { ListenTogetherStateSnapshot } from "@/lib/listen-together";
import { useChatStore } from "@/stores/chat-store";
import { useListenTogetherStore } from "@/stores/useListenTogetherStore";

describe("SoundboardPicker selection mode", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    useChatStore.setState({
      servers: [
        {
          id: "server-1",
          name: "Alpha",
          owner_id: "user-1",
          icon_url: null,
          created_at: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "server-2",
          name: "Beta",
          owner_id: "user-1",
          icon_url: null,
          created_at: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    mocks.apiGet.mockReset();
    mocks.apiPost.mockReset();
    localStorage.clear();
    mocks.apiGet.mockImplementation((url: string) => {
      if (url.includes("server-1")) {
        return Promise.resolve([
          {
            id: "clip-1",
            name: "Server clip",
            file_url: "/api/attachments/clip-1",
            volume: 1,
          },
        ]);
      }
      if (url.includes("server-2")) return Promise.reject(new Error("stale"));
      return Promise.reject(new Error("unsupported request"));
    });
    useListenTogetherStore.setState({ rooms: {} });
  });

  it("does not expose stored local sounds in a DM scope", async () => {
    useChatStore.setState({ servers: [] });
    mocks.apiGet.mockResolvedValue({ favorites: [] });
    localStorage.setItem(
      "voice-soundboard:dm-call",
      JSON.stringify([
        {
          id: "local-clip",
          name: "Local clip",
          dataUrl: "data:audio/mpeg;base64,AA==",
        },
      ]),
    );
    const observedDuringLayout: boolean[] = [];

    function LayoutProbe() {
      useLayoutEffect(() => {
        observedDuringLayout.push(
          screen.queryByRole("button", { name: "Play Local clip" }) === null,
        );
      }, []);
      return null;
    }

    render(
      <>
        <LayoutProbe />
        <SoundboardPicker onClose={vi.fn()} sfu={null} />
      </>,
    );

    expect(observedDuringLayout).toEqual([true]);
    await waitFor(() =>
      expect(
        screen.getByRole("dialog", { name: "Soundboard picker" }),
      ).toBeVisible(),
    );
    expect(
      screen.queryByRole("button", { name: "Play Local clip" }),
    ).toBeNull();
  });

  it("limits DM sounds to defaults and member-server catalog entries", async () => {
    mocks.apiGet.mockImplementation((url: string) => {
      if (url === "/api/myinstants/favorites") {
        return Promise.resolve({
          favorites: [
            {
              id: "external-favorite",
              title: "External favorite",
              url: "https://www.myinstants.com/media/sounds/external.mp3",
              color: "#4f46e5",
              soundType: "myinstants",
            },
            {
              id: "local-favorite",
              title: "Local favorite",
              url: "data:audio/mpeg;base64,AA==",
              color: "#4f46e5",
              soundType: "custom",
            },
            {
              id: "clip-1",
              title: "Member favorite",
              url: "/api/soundboard/uploads/clip-1",
              color: "#4f46e5",
              soundType: "server",
              source_server_id: "server-1",
              serverId: "server-1",
            },
          ],
        });
      }
      if (url.includes("server-1")) {
        return Promise.resolve([
          {
            id: "clip-1",
            name: "Member clip",
            file_url: "/api/soundboard/uploads/clip-1",
            server_id: "server-1",
          },
        ]);
      }
      if (url.includes("server-2")) return Promise.resolve([]);
      return Promise.reject(new Error("unsupported request"));
    });

    render(
      <SoundboardPicker onClose={vi.fn()} sfu={null} localUserId="user-1" />,
    );

    expect(
      await screen.findByRole("button", { name: "Play Ping" }),
    ).toBeVisible();
    expect(
      await screen.findByRole("button", { name: "Play Member clip" }),
    ).toBeVisible();
    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "Play External favorite" }),
      ).toBeNull();
      expect(
        screen.queryByRole("button", { name: "Play Local favorite" }),
      ).toBeNull();
      expect(screen.queryByRole("button", { name: "Add Sound" })).toBeNull();
      expect(screen.queryByText("Discover")).toBeNull();
      expect(
        screen.queryByRole("button", { name: "Custom Sounds" }),
      ).toBeNull();
    });
  });

  it("replays hydrated legacy server favorites and hides external impostors", async () => {
    mocks.apiGet.mockImplementation((url: string) => {
      if (url === "/api/myinstants/favorites") {
        return Promise.resolve({
          favorites: [
            {
              id: "legacy-clip",
              title: "Legacy server favorite",
              url: "/api/soundboard/uploads/legacy-clip",
              color: "#4f46e5",
              soundType: "myinstants",
              source_server_id: "server-1",
              serverId: "server-1",
            },
            {
              id: "external-impostor",
              title: "External impostor",
              url: "https://www.myinstants.com/media/sounds/external.mp3",
              color: "#4f46e5",
              soundType: "server",
              source_server_id: "server-1",
              serverId: "server-1",
            },
          ],
        });
      }
      if (url.includes("server-1")) {
        return Promise.resolve([
          {
            id: "legacy-clip",
            name: "Catalog legacy clip",
            file_url: "/api/soundboard/uploads/legacy-clip",
            server_id: "server-1",
          },
        ]);
      }
      if (url.includes("server-2")) return Promise.resolve([]);
      return Promise.reject(new Error("unsupported request"));
    });
    const sendAppEvent = vi.fn(() => true);

    render(
      <SoundboardPicker
        onClose={vi.fn()}
        sfu={{ on: vi.fn(() => vi.fn()), voiceGW: { sendAppEvent } } as never}
        localUserId="user-1"
      />,
    );

    const legacyFavorite = await screen.findByRole("button", {
      name: "Play Legacy server favorite",
    });
    expect(
      screen.queryByRole("button", { name: "Play External impostor" }),
    ).toBeNull();

    await userEvent.setup().click(legacyFavorite);

    expect(sendAppEvent).toHaveBeenCalledTimes(1);
    expect(sendAppEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "soundboard.play",
        sound_id: "legacy-clip",
        source_server_id: "server-1",
        media_url: "/api/soundboard/uploads/legacy-clip",
      }),
    );
    expect(sendAppEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ sound_id: "external-impostor" }),
    );
  });

  it.each(["myinstants", "radio"] as const)(
    "does not expose the %s external sound path in a DM picker",
    async (initialView) => {
      useChatStore.setState({ servers: [] });
      mocks.apiGet.mockResolvedValue({ favorites: [] });
      const sendAppEvent = vi.fn();

      render(
        <SoundboardPicker
          onClose={vi.fn()}
          initialView={initialView}
          sfu={{ on: vi.fn(() => vi.fn()), voiceGW: { sendAppEvent } } as never}
          localUserId="user-1"
        />,
      );

      expect(
        await screen.findByRole("button", { name: "Play Ping" }),
      ).toBeVisible();
      expect(screen.queryByPlaceholderText("Search MyInstants...")).toBeNull();
      expect(
        screen.queryByPlaceholderText("Search Radio Stations..."),
      ).toBeNull();
      expect(screen.queryByText("Discover")).toBeNull();
      expect(screen.queryByText("Radio")).toBeNull();
      expect(sendAppEvent).not.toHaveBeenCalled();
    },
  );

  it("plays a default sound in a DM without sending media", async () => {
    useChatStore.setState({ servers: [] });
    mocks.apiGet.mockResolvedValue({ favorites: [] });
    const sendAppEvent = vi.fn(() => true);

    render(
      <SoundboardPicker
        onClose={vi.fn()}
        sfu={{ on: vi.fn(() => vi.fn()), voiceGW: { sendAppEvent } } as never}
        localUserId="user-1"
      />,
    );

    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: "Play Ping" }));

    expect(sendAppEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "soundboard.play",
        sound_id: "ping",
      }),
    );
    const firstCall = sendAppEvent.mock.calls[0] as unknown as
      | [Record<string, unknown>]
      | undefined;
    expect(firstCall?.[0]).not.toHaveProperty("media_url");
    expect(firstCall?.[0]).not.toHaveProperty("data_url");
    expect(firstCall?.[0]).not.toHaveProperty("source_server_id");
  });

  it("does not expose a local sound even when it has a server media URL", async () => {
    useChatStore.setState({ servers: [] });
    mocks.apiGet.mockResolvedValue({ favorites: [] });
    localStorage.setItem(
      "voice-soundboard:dm-call",
      JSON.stringify([
        {
          id: "dual-source-clip",
          name: "Dual source clip",
          dataUrl: "data:audio/mpeg;base64,AA==",
          mediaUrl: "/api/soundboard/uploads/dual-source-clip",
        },
      ]),
    );
    const sendAppEvent = vi.fn();

    render(
      <SoundboardPicker
        onClose={vi.fn()}
        sfu={{ on: vi.fn(() => vi.fn()), voiceGW: { sendAppEvent } } as never}
        localUserId="user-1"
      />,
    );

    expect(
      await screen.findByRole("button", { name: "Play Ping" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Play Dual source clip" }),
    ).toBeNull();
    expect(sendAppEvent).not.toHaveBeenCalled();
  });

  it("sends a member server sound's source server in a DM scope", async () => {
    mocks.apiGet.mockImplementation((url: string) => {
      if (url.includes("server-1")) {
        return Promise.resolve([
          {
            id: "clip-1",
            name: "Server clip",
            file_url: "/api/soundboard/uploads/clip-1",
            volume: 1,
          },
        ]);
      }
      if (url === "/api/myinstants/favorites") {
        return Promise.resolve({ favorites: [] });
      }
      return Promise.reject(new Error("unsupported request"));
    });
    const sendAppEvent = vi.fn();
    render(
      <SoundboardPicker
        onClose={vi.fn()}
        sfu={{ on: vi.fn(() => vi.fn()), voiceGW: { sendAppEvent } } as never}
        localUserId="user-1"
      />,
    );

    const playButton = await screen.findByRole("button", {
      name: "Play Server clip",
    });
    await userEvent.setup().click(playButton);

    expect(sendAppEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "soundboard.play",
        server_key: "dm-call",
        source_server_id: "server-1",
        sound_id: "clip-1",
        media_url: "/api/soundboard/uploads/clip-1",
      }),
    );
  });

  it("uses only the admitted server catalog in a server voice scope", async () => {
    mocks.apiGet.mockImplementation((url: string) => {
      if (url === "/api/myinstants/favorites") {
        return Promise.resolve({ favorites: [] });
      }
      if (url.includes("server-1")) {
        return Promise.resolve([
          {
            id: "wrong-server-clip",
            name: "Wrong server clip",
            file_url: "/api/soundboard/uploads/wrong-server-clip",
            server_id: "server-1",
          },
        ]);
      }
      if (url.includes("server-2")) {
        return Promise.resolve([
          {
            id: "admitted-clip",
            name: "Admitted server clip",
            file_url: "/api/soundboard/uploads/admitted-clip",
            server_id: "server-2",
          },
        ]);
      }
      return Promise.reject(new Error("unsupported request"));
    });
    const sendAppEvent = vi.fn();

    render(
      <SoundboardPicker
        onClose={vi.fn()}
        sfu={{ on: vi.fn(() => vi.fn()), voiceGW: { sendAppEvent } } as never}
        serverId="server-2"
        channelId="channel-1"
        localUserId="user-1"
      />,
    );

    expect(
      await screen.findByRole("button", { name: "Play Admitted server clip" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Play Wrong server clip" }),
    ).toBeNull();
    expect(mocks.apiGet.mock.calls.map(([url]) => url)).not.toContain(
      "/api/servers/server-1/soundboard",
    );

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Play Admitted server clip" }));
    expect(sendAppEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        server_key: "server-2",
        sound_id: "admitted-clip",
        media_url: "/api/soundboard/uploads/admitted-clip",
      }),
    );
    expect(sendAppEvent.mock.calls[0]?.[0]).not.toHaveProperty(
      "source_server_id",
    );
  });

  it("replays a server favorite into a DM with source_server_id", async () => {
    mocks.apiGet.mockImplementation((url: string) => {
      if (url === "/api/myinstants/favorites") {
        return Promise.resolve({
          favorites: [
            {
              id: "clip-1",
              title: "Favorite server clip",
              url: "/api/soundboard/uploads/clip-1",
              color: "#4f46e5",
              soundType: "server",
              serverId: "server-1",
            },
          ],
        });
      }
      if (url.includes("/soundboard")) {
        return Promise.resolve([
          {
            id: "clip-1",
            name: "Favorite server clip",
            file_url: "/api/soundboard/uploads/clip-1",
            server_id: "server-1",
          },
        ]);
      }
      return Promise.reject(new Error("unsupported request"));
    });
    const sendAppEvent = vi.fn();

    render(
      <SoundboardPicker
        onClose={vi.fn()}
        sfu={{ voiceGW: { sendAppEvent } } as never}
        localUserId="user-1"
      />,
    );

    const favoriteButtons = await screen.findAllByRole("button", {
      name: "Play Favorite server clip",
    });
    await userEvent.setup().click(favoriteButtons[0]);

    expect(sendAppEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        server_key: "dm-call",
        sound_id: "clip-1",
        source_server_id: "server-1",
        media_url: "/api/soundboard/uploads/clip-1",
      }),
    );
  });

  it("persists server favorite metadata when toggled from the server catalog", async () => {
    mocks.apiGet.mockImplementation((url: string) => {
      if (url === "/api/myinstants/favorites") {
        return Promise.resolve({ favorites: [] });
      }
      if (url.includes("server-1")) {
        return Promise.resolve([
          {
            id: "clip-1",
            name: "Server clip",
            file_url: "/api/soundboard/uploads/clip-1",
            server_id: "server-1",
          },
        ]);
      }
      return Promise.reject(new Error("unsupported request"));
    });
    mocks.apiPost.mockResolvedValue({ success: true });

    render(
      <SoundboardPicker onClose={vi.fn()} sfu={null} localUserId="user-1" />,
    );

    const playButton = await screen.findByRole("button", {
      name: "Play Server clip",
    });
    const favoriteButton = playButton.parentElement?.querySelector(
      'button[aria-label="Add to favorites"]',
    );
    expect(favoriteButton).not.toBeNull();
    await userEvent.setup().click(favoriteButton as HTMLButtonElement);

    expect(mocks.apiPost).toHaveBeenCalledWith(
      "/api/myinstants/favorites",
      expect.objectContaining({
        action: "add",
        sound: expect.objectContaining({
          soundType: "server",
          serverId: "server-1",
          source_server_id: "server-1",
        }),
      }),
    );
  });

  it("fails closed when a server favorite belongs to another voice server", async () => {
    mocks.apiGet.mockImplementation((url: string) => {
      if (url === "/api/myinstants/favorites") {
        return Promise.resolve({
          favorites: [
            {
              id: "clip-1",
              title: "Other server favorite",
              url: "/api/soundboard/uploads/clip-1",
              color: "#4f46e5",
              soundType: "server",
              serverId: "server-1",
              source_server_id: "server-1",
            },
          ],
        });
      }
      if (url.includes("/soundboard")) return Promise.resolve([]);
      return Promise.reject(new Error("unsupported request"));
    });
    const sendAppEvent = vi.fn();

    render(
      <SoundboardPicker
        onClose={vi.fn()}
        sfu={{ on: vi.fn(() => vi.fn()), voiceGW: { sendAppEvent } } as never}
        serverId="server-2"
        channelId="channel-1"
        localUserId="user-1"
      />,
    );

    await userEvent.setup().click(
      await screen.findByRole("button", {
        name: "Play Other server favorite",
      }),
    );

    expect(sendAppEvent).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "This server sound is not available in the current voice server.",
    );
  });

  it("does not expose local uploads in a DM picker", async () => {
    useChatStore.setState({ servers: [] });
    mocks.apiGet.mockResolvedValue({ favorites: [] });

    render(<SoundboardPicker onClose={vi.fn()} sfu={null} />);
    expect(screen.queryByRole("button", { name: "Add Sound" })).toBeNull();
    expect(localStorage.getItem("voice-soundboard:dm-call")).toBeNull();
  });

  it("does not expose oversized local uploads in a DM picker", async () => {
    useChatStore.setState({ servers: [] });
    mocks.apiGet.mockResolvedValue({ favorites: [] });
    const readAsDataURL = vi.spyOn(FileReader.prototype, "readAsDataURL");

    render(<SoundboardPicker onClose={vi.fn()} sfu={null} />);

    expect(screen.queryByRole("button", { name: "Add Sound" })).toBeNull();
    expect(readAsDataURL).not.toHaveBeenCalled();
    expect(localStorage.getItem("voice-soundboard:dm-call")).toBeNull();
  });

  it("keeps selection mode on default/server sounds and hides unsupported paths", async () => {
    const marker = document.createElement("button");
    document.body.appendChild(marker);

    render(
      <SoundboardPicker
        onClose={vi.fn()}
        sfu={null}
        selectionMode
        compact
        markerRef={{ current: marker }}
        serverIds={["server-1", "server-2"]}
      />,
    );

    expect(screen.queryByText("Listen")).toBeNull();
    expect(screen.queryByText("Radio")).toBeNull();
    expect(screen.queryByText("Discover")).toBeNull();
    expect(screen.queryByText("Favorites")).toBeNull();
    expect(screen.queryByText("Now Playing")).toBeNull();
    expect(screen.queryByRole("button", { name: "Custom Sounds" })).toBeNull();
    expect(
      screen.getAllByRole("button", { name: "Ralph Sounds" })[0],
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Jump to Alpha server sounds" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "Play Ping" }),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Server clip")).toBeVisible());
    const picker = screen.getByRole("dialog", { name: "Soundboard picker" });
    expect(picker).toHaveStyle({ zIndex: "1100" });
    expect(picker).not.toHaveClass("inset-0");
    expect(picker).not.toHaveClass("bottom-[calc(100%+10px)]");
    expect(picker).toHaveClass("sm:w-[min(440px,calc(100vw-24px))]");
    expect(document.querySelector('div[aria-hidden="true"]')).toBeNull();
  });

  it("keeps the add sound action in the live server picker", async () => {
    render(
      <SoundboardPicker
        onClose={vi.fn()}
        sfu={null}
        serverId="server-1"
        channelId="channel-1"
      />,
    );

    expect(
      await screen.findByRole("button", { name: /add sound/i }),
    ).toBeVisible();
    expect(
      screen.getByRole("slider", { name: "Soundboard Volume" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Now Playing")).toBeNull();
    expect(screen.queryByRole("button", { name: "Server Sounds" })).toBeNull();
  });

  it("defers favorites and server soundboard fetches from the direct listen view", async () => {
    mocks.apiGet.mockImplementation((url: string) => {
      if (url === "/api/myinstants/favorites") {
        return Promise.resolve({ favorites: [] });
      }
      if (url.includes("/soundboard")) return Promise.resolve([]);
      return Promise.reject(new Error("unsupported request"));
    });

    render(
      <SoundboardPicker
        onClose={vi.fn()}
        sfu={null}
        serverId="server-1"
        initialView="listenTogether"
        roomSlug="room-1"
        voiceSessionId="voice-1"
      />,
    );

    await Promise.resolve();
    expect(mocks.apiGet).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    await waitFor(() => {
      expect(mocks.apiGet).toHaveBeenCalledWith("/api/myinstants/favorites");
      expect(mocks.apiGet).toHaveBeenCalledWith(
        expect.stringContaining("/api/servers/server-1/soundboard"),
        expect.anything(),
      );
    });
  });

  it("does not close on Escape from a listen-together seek range", () => {
    const entry = {
      entryId: "entry-1",
      requestedAt: 1_000,
      requester: {
        userId: "user-1",
        displayName: "Alice",
        avatarUrl: null,
        avatarDisplay: null,
      },
      track: {
        kind: "music" as const,
        id: "track-1",
        provider: "youtube" as const,
        videoId: "video-1",
        title: "Track One",
        artist: "Artist",
        album: null,
        durationMs: 180_000,
        artworkUrl: null,
        canonicalUrl: "https://www.youtube.com/watch?v=video-1",
        sourceUrl: null,
        sourceLabel: "YouTube",
      },
    };
    const snapshot: ListenTogetherStateSnapshot = {
      roomSlug: "room-1",
      revision: 1,
      paused: false,
      currentEntryId: entry.entryId,
      anchorPositionMs: 0,
      anchorUpdatedAt: 1_000,
      lastUpdatedAt: 1_000,
      queue: [entry],
      currentEntry: entry,
      positionMs: 0,
      durationMs: entry.track.durationMs,
    };
    const onClose = vi.fn();
    useListenTogetherStore.setState({
      rooms: { "room-1": { snapshot, localVolume: 1, error: null } },
    });

    render(
      <SoundboardPicker
        onClose={onClose}
        sfu={null}
        initialView="listenTogether"
        roomSlug="room-1"
        voiceSessionId="voice-1"
      />,
    );

    fireEvent.keyDown(screen.getByRole("slider", { name: "Seek Track One" }), {
      key: "Escape",
    });

    expect(onClose).not.toHaveBeenCalled();
  });

  it("uses a standalone dialog for destructive sound confirmation", async () => {
    render(
      <SoundboardPicker
        onClose={() => {}}
        sfu={null}
        serverId="server-1"
        channelId="channel-1"
      />,
    );

    const playButton = await screen.findByRole("button", {
      name: "Play Server clip",
    });
    const deleteButton =
      playButton.parentElement?.querySelector(
        "svg.lucide-trash-2",
      )?.parentElement;
    expect(deleteButton).not.toBeNull();
    fireEvent.click(deleteButton as HTMLElement);

    const dialog = screen.getByRole("dialog", { name: "Delete Sound" });
    expect(dialog.querySelector("button button")).toBeNull();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("closes the child confirmation on Escape without closing the picker", async () => {
    const onClose = vi.fn();
    render(
      <SoundboardPicker
        onClose={onClose}
        sfu={null}
        serverId="server-1"
        channelId="channel-1"
      />,
    );

    const playButton = await screen.findByRole("button", {
      name: "Play Server clip",
    });
    const deleteButton = playButton.parentElement?.querySelector(
      "svg.lucide-trash-2",
    )?.parentElement as HTMLButtonElement | null;
    expect(deleteButton).not.toBeNull();
    deleteButton?.focus();
    fireEvent.click(deleteButton as HTMLButtonElement);

    const cancelButton = screen.getByRole("button", { name: "Cancel" });
    expect(cancelButton).toHaveFocus();
    fireEvent.keyDown(cancelButton, { key: "Escape" });

    expect(
      screen.queryByRole("dialog", { name: "Delete Sound" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("dialog", { name: "Soundboard picker" }),
    ).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(deleteButton).toHaveFocus();
  });

  it("shows member servers in the live picker rail and selects a server section", async () => {
    const user = userEvent.setup();
    render(
      <SoundboardPicker
        onClose={vi.fn()}
        sfu={null}
        serverId="server-2"
        channelId="channel-1"
      />,
    );

    const betaButton = await screen.findByRole("button", {
      name: "Jump to Beta server sounds",
    });
    expect(
      screen.queryByRole("button", { name: "Jump to Alpha server sounds" }),
    ).toBeNull();
    expect(
      screen.getAllByRole("button", { name: /server sounds/i })[0],
    ).toHaveAccessibleName("Jump to Beta server sounds");

    await user.click(betaButton);
    expect(betaButton).toHaveAttribute("aria-pressed", "true");
  });
});
