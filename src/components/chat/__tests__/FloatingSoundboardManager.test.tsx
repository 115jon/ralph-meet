// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SFUClient } from "@/lib/sfu-client";
import {
  useVoiceSoundboardStore,
  type VoiceSoundboardStore,
} from "@/stores/useVoiceSoundboardStore";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FloatingSoundboardManager } from "../FloatingSoundboardManager";

vi.mock("@/stores/useVoiceSoundboardStore");
vi.mock("@/hooks/useUserResolution", () => ({
  useUserResolution: () => ({
    displayName: "Jonathan Martinez",
    avatarUrl: null,
    avatarDisplay: null,
  }),
}));
vi.mock("@/lib/voice/soundboard", () => ({
  getSoundboardServerKey: (serverId?: string | null) => serverId || "dm-call",
  pauseSoundboardPlayback: vi.fn(),
  resumeSoundboardPlayback: vi.fn(),
  setSoundboardPlaybackVolume: vi.fn(),
  stopSoundboardPlayback: vi.fn(),
}));

describe("FloatingSoundboardManager", () => {
  const makeStore = (
    activePlaybacks: VoiceSoundboardStore["activePlaybacks"],
  ): VoiceSoundboardStore => ({
    activePlaybacks,
    serverMutedByServer: {},
    upsertPlayback: vi.fn(),
    removePlayback: vi.fn(),
    clearServerPlaybacks: vi.fn(),
    setPlaybackPaused: vi.fn(),
    setPlaybackVolume: vi.fn(),
    setServerSoundboardMuted: vi.fn(),
  });

  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        disconnect() {}
        observe() {}
        unobserve() {}
      },
    );
    vi.mocked(useVoiceSoundboardStore).mockImplementation((selector) =>
      selector(
        makeStore({
          first: {
            playbackId: "first",
            ownerId: "user-1",
            serverKey: "server-1",
            name: "Airhorn",
            isLocal: true,
            startedAt: 2,
            paused: false,
            volume: 0.8,
          },
          second: {
            playbackId: "second",
            ownerId: "user-1",
            serverKey: "server-1",
            name: "Drumroll",
            isLocal: true,
            startedAt: 1,
            paused: true,
            volume: 0.5,
          },
        }),
      ),
    );
  });

  it("presents a floating manager without an active text dump", () => {
    render(
      <FloatingSoundboardManager
        serverId="server-1"
        localUserId="user-1"
        sfu={null}
      />,
    );

    expect(
      screen.getByTestId("floating-soundboard-manager"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Collapse soundboard manager" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Collapse soundboard manager" }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("floating-soundboard-manager")).not.toHaveClass(
      "bottom-4",
    );
    expect(screen.getByText("Airhorn")).toBeInTheDocument();
    expect(screen.queryByText("2 active")).not.toBeInTheDocument();
  });

  it("collapses the manager while keeping its floating trigger available", async () => {
    const user = userEvent.setup();
    render(
      <FloatingSoundboardManager
        serverId="server-1"
        localUserId="user-1"
        sfu={null as unknown as SFUClient}
      />,
    );

    expect(screen.getByText("Soundboard")).toBeInTheDocument();
    expect(screen.getByText("Airhorn")).toBeInTheDocument();
    expect(screen.getByText("Drumroll")).toBeInTheDocument();
    expect(screen.getAllByRole("slider")).toHaveLength(2);

    await user.click(
      screen.getByRole("button", { name: "Collapse soundboard manager" }),
    );

    expect(
      screen.getByTestId("floating-soundboard-manager"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Airhorn")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open soundboard manager" }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  it("keeps playback tooltips on the dark floating surface", async () => {
    const user = userEvent.setup();
    render(
      <FloatingSoundboardManager
        serverId="server-1"
        localUserId="user-1"
        sfu={null}
      />,
    );

    await user.hover(screen.getByRole("button", { name: "Pause" }));

    await waitFor(() => {
      const tooltip = document.querySelector('[data-slot="tooltip-content"]');
      expect(tooltip).not.toBeNull();
      expect(tooltip).toHaveClass("bg-rm-bg-floating");
    });
  });

  it("sends volume changes with the current server scope", () => {
    const sendAppEvent = vi.fn(() => true);
    const sfu = {
      voiceGW: { sendAppEvent },
    } as unknown as SFUClient;

    render(
      <FloatingSoundboardManager
        serverId="server-1"
        localUserId="user-1"
        sfu={sfu}
      />,
    );

    const slider = screen.getByRole("slider", { name: "Volume for Airhorn" });
    fireEvent.change(slider, { target: { value: "100" } });

    expect(sendAppEvent).toHaveBeenCalledWith({
      type: "soundboard.volume-set",
      server_key: "server-1",
      user_id: "user-1",
      playback_id: "first",
      volume: 1,
    });
  });

  it("drags from both the header and collapsed trigger without toggling", async () => {
    const user = userEvent.setup();
    render(
      <FloatingSoundboardManager
        serverId="server-1"
        localUserId="user-1"
        sfu={null}
      />,
    );

    const manager = screen.getByTestId("floating-soundboard-manager");
    manager.setPointerCapture = vi.fn();
    manager.hasPointerCapture = () => false;
    manager.releasePointerCapture = vi.fn();
    const header = screen.getByRole("button", {
      name: "Collapse soundboard manager",
    });

    fireEvent.pointerDown(header, {
      button: 0,
      pointerId: 1,
      clientX: 10,
      clientY: 10,
    });
    fireEvent.pointerMove(manager, {
      pointerId: 1,
      clientX: 110,
      clientY: 110,
    });
    fireEvent.pointerUp(manager, { pointerId: 1 });
    fireEvent.click(header);

    expect(manager).toHaveStyle({ left: "100px", top: "100px" });
    expect(header).toHaveAttribute("aria-expanded", "true");

    await user.click(header);
    const trigger = screen.getByRole("button", {
      name: "Open soundboard manager",
    });

    fireEvent.pointerDown(trigger, {
      button: 0,
      pointerId: 2,
      clientX: 10,
      clientY: 10,
    });
    fireEvent.pointerMove(manager, {
      pointerId: 2,
      clientX: 210,
      clientY: 210,
    });
    fireEvent.pointerUp(manager, { pointerId: 2 });
    fireEvent.click(trigger);

    expect(manager).toHaveStyle({ left: "200px", top: "200px" });
    expect(
      screen.getByRole("button", { name: "Open soundboard manager" }),
    ).toHaveAttribute("aria-expanded", "false");
  });
});
