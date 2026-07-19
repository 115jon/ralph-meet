// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLayoutEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ apiGet: vi.fn() }));

vi.mock("@/lib/api-client", () => ({
  apiGet: mocks.apiGet,
  apiPost: vi.fn(),
  apiUpload: vi.fn(),
  apiDelete: vi.fn(),
  apiPatch: vi.fn(),
}));

import SoundboardPicker from "@/components/chat/SoundboardPicker";
import type { ListenTogetherStateSnapshot } from "@/lib/listen-together";
import { useChatStore } from "@/stores/chat-store";
import { useListenTogetherStore } from "@/stores/useListenTogetherStore";

describe("SoundboardPicker selection mode", () => {
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

  it("renders stored local sounds before passive effects run", async () => {
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
          screen.queryByRole("button", { name: "Play Local clip" }) !== null,
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
      screen.getByRole("button", { name: "Jump to Alpha server sounds" }),
    ).toBeVisible();
    expect(
      screen.getAllByRole("button", { name: /server sounds/i })[0],
    ).toHaveAccessibleName("Jump to Beta server sounds");

    await user.click(betaButton);
    expect(betaButton).toHaveAttribute("aria-pressed", "true");
  });
});
