// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
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
import { useChatStore } from "@/stores/chat-store";

const touch = { pointerType: "touch", isPrimary: true, pointerId: 1 };

describe("SoundboardPicker tile actions on touch", () => {
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
      ],
    });
    mocks.apiGet.mockReset();
    mocks.apiGet.mockImplementation((url: string) => {
      if (url.includes("/api/servers/server-1/soundboard")) {
        return Promise.resolve([
          {
            id: "clip-1",
            name: "Server clip",
            file_url: "/api/attachments/clip-1",
            volume: 1,
            server_id: "server-1",
          },
        ]);
      }
      if (url.includes("/api/myinstants/favorites")) {
        return Promise.resolve({ favorites: [] });
      }
      return Promise.reject(new Error("unsupported request"));
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("keeps preview and favourite visible on touch and hides edit/delete there", async () => {
    render(
      <SoundboardPicker
        onClose={vi.fn()}
        sfu={null}
        serverId="server-1"
        channelId="channel-1"
        localUserId="user-1"
      />,
    );

    const preview = await screen.findByRole("button", {
      name: "Preview Server clip",
    });
    // REVEAL: hidden only where a fine pointer can hover it back.
    const reveal = preview.parentElement!;
    expect(reveal.className).toContain("pointer-fine:opacity-0");
    expect(reveal.className).not.toMatch(/(^|\s)opacity-0(\s|$)/);

    const [favorite] = screen.getAllByRole("button", {
      name: "Add to favorites",
    });
    expect(favorite.className).toContain("pointer-fine:opacity-0");

    expect(
      screen.getByRole("button", { name: "Edit Server clip" }),
    ).toHaveClass("pointer-coarse:hidden");
    expect(
      screen.getByRole("button", { name: "Delete Server clip" }),
    ).toHaveClass("pointer-coarse:hidden");
  });

  it("opens the tile's actions as a sheet on a long press", async () => {
    render(
      <SoundboardPicker
        onClose={vi.fn()}
        sfu={null}
        serverId="server-1"
        channelId="channel-1"
        localUserId="user-1"
      />,
    );

    const play = await screen.findByRole("button", {
      name: "Play Server clip",
    });
    vi.useFakeTimers();
    fireEvent.pointerDown(play, { ...touch, clientX: 20, clientY: 20 });
    act(() => vi.advanceTimersByTime(450));
    vi.useRealTimers();

    expect(await screen.findByText("Edit sound")).toBeInTheDocument();
    expect(screen.getByText("Delete sound")).toBeInTheDocument();
  });
});
