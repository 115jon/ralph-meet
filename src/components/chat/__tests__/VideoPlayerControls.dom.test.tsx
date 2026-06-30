// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { VideoControlBar } from "../VideoPlayerControls";

vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const baseProps = {
  playing: false,
  ended: false,
  togglePlay: vi.fn(),
  displayTime: 0,
  duration: 10,
  muted: false,
  volume: 0.7,
  toggleMute: vi.fn(),
  handleVolumeChange: vi.fn(),
  toggleFullscreen: vi.fn(),
} as const;

function getVolumeElements() {
  const muteButton = screen.getByRole("button", { name: "Mute" });
  const volumeSlider = screen.getByLabelText("Volume");
  const volumeControl = muteButton.parentElement;
  const volumePopover = volumeSlider.parentElement?.parentElement;

  expect(volumeControl).not.toBeNull();
  expect(volumePopover).not.toBeNull();

  return {
    volumeControl: volumeControl!,
    volumePopover: volumePopover!,
    volumeSlider,
  };
}

describe("VideoControlBar volume popover", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("stays open long enough to move from the mute button into the slider", () => {
    render(<VideoControlBar {...baseProps} />);

    const { volumeControl, volumePopover } = getVolumeElements();

    expect(volumePopover).toHaveClass("pointer-events-none");

    fireEvent.mouseEnter(volumeControl);
    expect(volumePopover).toHaveClass("pointer-events-auto");

    fireEvent.mouseLeave(volumeControl);
    expect(volumePopover).toHaveClass("pointer-events-auto");

    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(volumePopover).toHaveClass("pointer-events-auto");

    fireEvent.mouseEnter(volumeControl);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(volumePopover).toHaveClass("pointer-events-auto");

    fireEvent.mouseLeave(volumeControl);
    act(() => {
      vi.advanceTimersByTime(120);
    });
    expect(volumePopover).toHaveClass("pointer-events-none");
  });

  it("stays open while the slider has focus", () => {
    render(<VideoControlBar {...baseProps} />);

    const { volumePopover, volumeSlider } = getVolumeElements();

    fireEvent.focus(volumeSlider);
    expect(volumePopover).toHaveClass("pointer-events-auto");

    fireEvent.blur(volumeSlider, {
      relatedTarget: screen.getByRole("button", { name: "Full Screen" }),
    });
    expect(volumePopover).toHaveClass("pointer-events-none");
  });
});
