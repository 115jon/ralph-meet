/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SoundboardPlaybackRow } from "../ActiveSoundboardEffectList";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { SFUClient } from "@/lib/sfu-client";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/hooks/useUserResolution", () => ({
  useUserResolution: (userId: string) => ({
    displayName: userId === "user-1" ? "Alice" : "Bob",
    avatarUrl: null,
    avatarDisplay: null,
  }),
}));

type Playback = Parameters<typeof SoundboardPlaybackRow>[0]["playback"];

function playback(overrides: Partial<Playback> = {}): Playback {
  return {
    playbackId: "effect-1",
    ownerId: "user-1",
    serverKey: "server-1",
    name: "Airhorn",
    isLocal: true,
    paused: false,
    volume: 1,
    ...overrides,
  };
}

describe("SoundboardPlaybackRow", () => {
  let mockSfu: SFUClient;

  beforeEach(() => {
    mockSfu = {
      voiceGW: {
        sendAppEvent: vi.fn(),
      },
    } as unknown as SFUClient;
  });

  function renderRow(
    item: Playback,
    variant: "default" | "compact" = "default",
  ) {
    return render(
      <TooltipProvider>
        <SoundboardPlaybackRow
          playback={item}
          localUserId="user-1"
          serverKey="server-1"
          sfu={mockSfu}
          variant={variant}
        />
      </TooltipProvider>,
    );
  }

  it("shows the sound and who played it", () => {
    renderRow(playback(), "compact");

    expect(screen.getByText("Airhorn")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });

  it("lets the local owner pause their effect", async () => {
    const user = userEvent.setup();
    renderRow(playback());

    await user.click(screen.getByRole("button", { name: "Pause" }));

    expect(mockSfu.voiceGW.sendAppEvent).toHaveBeenCalledWith({
      type: "soundboard.pause-set",
      server_key: "server-1",
      user_id: "user-1",
      playback_id: "effect-1",
      paused: true,
    });
  });

  it("offers no pause control on someone else's effect", () => {
    renderRow(
      playback({ playbackId: "effect-2", ownerId: "user-2", isLocal: false }),
    );

    expect(
      screen.queryByRole("button", { name: "Pause" }),
    ).not.toBeInTheDocument();
    expect(mockSfu.voiceGW.sendAppEvent).not.toHaveBeenCalled();
  });

  it("pauses a local preview without sending an app event", async () => {
    const user = userEvent.setup();
    renderRow(
      playback({ playbackId: "local-preview", name: "Preview: Airhorn" }),
    );

    await user.click(screen.getByRole("button", { name: "Pause" }));

    expect(mockSfu.voiceGW.sendAppEvent).not.toHaveBeenCalled();
  });

  it("stops a local preview without sending an app event", async () => {
    const user = userEvent.setup();
    renderRow(
      playback({ playbackId: "local-preview", name: "Preview: Airhorn" }),
    );

    await user.click(screen.getByRole("button", { name: "Stop" }));

    expect(mockSfu.voiceGW.sendAppEvent).not.toHaveBeenCalled();
  });

  it("sends a stop event for a shared effect", async () => {
    const user = userEvent.setup();
    renderRow(playback());

    await user.click(screen.getByRole("button", { name: "Stop" }));

    expect(mockSfu.voiceGW.sendAppEvent).toHaveBeenCalledWith({
      type: "soundboard.stop",
      server_key: "server-1",
      user_id: "user-1",
      playback_id: "effect-1",
    });
  });
});
