// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
import { useChatStore } from "@/stores/chat-store";

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
