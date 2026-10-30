// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  WarpRushActivityStage,
  WarpRushStatusScreen,
} from "../WarpRushActivityStage";

describe("WarpRushStatusScreen", () => {
  it("shows a loader while booting, with a plain line and no retry", () => {
    render(<WarpRushStatusScreen kind="booting" />);

    expect(screen.getByRole("status")).toHaveTextContent("Starting Warp Rush");
    expect(
      screen.queryByRole("button", { name: "Try again" }),
    ).not.toBeInTheDocument();
  });

  it("names the problem and the one fix when WebGL is missing", () => {
    const onRetry = vi.fn();
    render(<WarpRushStatusScreen kind="unsupported" onRetry={onRetry} />);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Warp Rush can't start");
    expect(alert).toHaveTextContent("graphics acceleration");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe("WarpRushActivityStage without WebGL", () => {
  beforeEach(() => {
    // jsdom has no WebGL: three's renderer throws and the stage falls back.
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("falls back to the unsupported screen and can retry", async () => {
    render(
      <WarpRushActivityStage
        sfu={null}
        channelId="channel-1"
        localUserId="user-1"
        participants={[{ userId: "user-1", name: "Ada" }]}
      />,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Warp Rush can't start",
    );
    // No HUD, and nothing about GPU stress or telemetry to scare anyone off.
    expect(screen.queryByText(/gpu|stress|workout/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});
