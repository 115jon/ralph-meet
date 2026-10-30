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
const soundboard = vi.hoisted(() => ({
  setSoundboardMasterVolume: vi.fn(),
}));

vi.mock("@/lib/voice/soundboard", () => ({
  getSoundboardServerKey: (serverId?: string | null) => serverId || "dm-call",
  getSoundboardMasterVolume: () => 0.6,
  setSoundboardMasterVolume: soundboard.setSoundboardMasterVolume,
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
    // Players remember corner and minimised state; start each test fresh.
    window.localStorage.clear();
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
    expect(screen.getByTestId("floating-soundboard-manager")).not.toHaveClass(
      "bottom-4",
    );
    expect(screen.getByText("Airhorn")).toBeInTheDocument();
    expect(screen.queryByText("2 active")).not.toBeInTheDocument();
    // Only the drag header blocks touch panning; the list must scroll.
    expect(screen.getByTestId("floating-soundboard-manager")).not.toHaveClass(
      "touch-none",
    );
    expect(
      screen
        .getByRole("button", { name: "Collapse soundboard manager" })
        .closest("header"),
    ).toHaveClass("touch-none");
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
    // One master volume in the header; per-sound volume waits behind each
    // row's expand.
    expect(
      screen.getByRole("slider", { name: "Soundboard volume" }),
    ).toBeInTheDocument();
    expect(
      screen.queryAllByRole("slider", { name: /^Volume for/ }),
    ).toHaveLength(0);
    for (const name of ["Airhorn", "Drumroll"]) {
      await user.click(
        screen.getByRole("button", { name: `Show volume for ${name}` }),
      );
    }
    expect(screen.getAllByRole("slider", { name: /^Volume for/ })).toHaveLength(
      2,
    );
    expect(
      screen.getByRole("button", { name: "Hide volume for Airhorn" }),
    ).toHaveAttribute("aria-expanded", "true");

    await user.click(
      screen.getByRole("button", { name: "Collapse soundboard manager" }),
    );

    expect(
      screen.getByTestId("floating-soundboard-manager"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Airhorn")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open soundboard manager" }),
    ).toHaveFocus();
  });

  it("does not require Pointer Capture APIs", () => {
    render(
      <FloatingSoundboardManager
        serverId="server-1"
        localUserId="user-1"
        sfu={null}
      />,
    );

    const manager = screen.getByTestId("floating-soundboard-manager");
    const handle = screen.getByRole("button", {
      name: "Collapse soundboard manager",
    });

    expect(() => {
      fireEvent.pointerDown(handle, {
        button: 0,
        pointerId: 1,
        clientX: 10,
        clientY: 10,
      });
      fireEvent.pointerUp(manager, { pointerId: 1 });
    }).not.toThrow();
  });

  it("keeps playback tooltips on the shared inverted surface", async () => {
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
      expect(tooltip).toHaveClass("bg-ink-1", "text-ply-0");
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

    fireEvent.click(
      screen.getByRole("button", { name: "Show volume for Airhorn" }),
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

  it("sets the master volume from the header without sending a room event", () => {
    const sendAppEvent = vi.fn(() => true);
    render(
      <FloatingSoundboardManager
        serverId="server-1"
        localUserId="user-1"
        sfu={{ voiceGW: { sendAppEvent } } as unknown as SFUClient}
      />,
    );

    const master = screen.getByRole("slider", { name: "Soundboard volume" });
    expect(master.closest("header")).not.toBeNull();
    fireEvent.change(master, { target: { value: "40" } });

    expect(soundboard.setSoundboardMasterVolume).toHaveBeenLastCalledWith(0.4);
    expect(screen.getByText("40%")).toBeInTheDocument();
    expect(sendAppEvent).not.toHaveBeenCalled();
  });

  it("drags from both the header and the minimised bubble without toggling", async () => {
    const user = userEvent.setup();
    window.localStorage.clear();
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
    expect(manager).toHaveAttribute("data-corner", "top-right");

    // Header title: a drag snaps to the bottom-left quadrant it lands in.
    const title = screen.getByText("Soundboard");
    fireEvent.pointerDown(title, {
      button: 0,
      pointerId: 1,
      clientX: 900,
      clientY: 80,
    });
    fireEvent.pointerMove(manager, {
      pointerId: 1,
      clientX: 600,
      clientY: 400,
    });
    fireEvent.pointerMove(manager, {
      pointerId: 1,
      clientX: 100,
      clientY: 700,
    });
    fireEvent.pointerUp(manager, { pointerId: 1 });
    expect(manager).toHaveAttribute("data-corner", "bottom-left");
    expect(manager).toHaveAttribute("data-mode", "full");

    await user.click(
      screen.getByRole("button", { name: "Collapse soundboard manager" }),
    );
    const bubble = screen.getByRole("button", {
      name: "Open soundboard manager",
    });

    // Dragging the bubble moves it and doesn't count as the restoring tap.
    fireEvent.pointerDown(bubble, {
      button: 0,
      pointerId: 2,
      clientX: 40,
      clientY: 700,
    });
    fireEvent.pointerMove(manager, {
      pointerId: 2,
      clientX: 500,
      clientY: 300,
    });
    fireEvent.pointerMove(manager, {
      pointerId: 2,
      clientX: 1000,
      clientY: 60,
    });
    fireEvent.pointerUp(manager, { pointerId: 2 });
    fireEvent.click(bubble);

    expect(manager).toHaveAttribute("data-corner", "top-right");
    expect(manager).toHaveAttribute("data-mode", "bubble");
  });
});
