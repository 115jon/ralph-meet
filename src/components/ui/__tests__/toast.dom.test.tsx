// @vitest-environment jsdom

import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const custom = vi.hoisted(() => vi.fn());

vi.mock("sonner", async (importOriginal) => {
  const actual = await importOriginal<typeof import("sonner")>();
  const realCustom = actual.toast.custom.bind(actual.toast);
  actual.toast.custom = (...args: Parameters<typeof realCustom>) => {
    custom(...args);
    return realCustom(...args);
  };
  return actual;
});

import {
  TOAST_DURATION_MS,
  Toaster,
  copyToClipboard,
  measureToastClearance,
  toast,
} from "../toast";

afterEach(() => {
  act(() => {
    toast.dismiss();
  });
  custom.mockClear();
});

describe("toast", () => {
  it("renders a role=status card with a dismiss button in a z-80 stack", async () => {
    const { container } = render(<Toaster />);
    act(() => {
      toast.success("Server ID copied");
    });

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Server ID copied");
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
    const stack = document.querySelector<HTMLElement>("[data-sonner-toaster]");
    expect(stack?.style.zIndex).toBe("80");
    expect(container).toBeTruthy();
  });

  it("lasts 4s for success and info, and errors stay until dismissed", () => {
    render(<Toaster />);
    act(() => {
      toast.success("Copied");
      toast.info("Heads up");
      toast.error("Unable to ban this member.");
    });
    const durations = custom.mock.calls.map((call) => call[1]?.duration);
    expect(durations).toEqual([
      TOAST_DURATION_MS,
      TOAST_DURATION_MS,
      Number.POSITIVE_INFINITY,
    ]);
    expect(TOAST_DURATION_MS).toBe(4000);
  });

  it("dismiss removes the toast", async () => {
    render(<Toaster />);
    act(() => {
      toast.error("Upload failed");
    });
    const dismiss = await screen.findByRole("button", { name: "Dismiss" });
    act(() => dismiss.click());
    await waitFor(() =>
      expect(screen.queryByText("Upload failed")).not.toBeInTheDocument(),
    );
  });

  it("measures clearance above the composer / tab bar", () => {
    const composer = document.createElement("div");
    composer.setAttribute("data-floating-avoid", "");
    document.body.appendChild(composer);
    const vh = window.innerHeight;
    composer.getBoundingClientRect = () =>
      ({
        top: vh - 72,
        bottom: vh,
        left: 0,
        right: 390,
        width: 390,
        height: 72,
      }) as DOMRect;

    expect(measureToastClearance()).toBe(72);
    expect(
      document.documentElement.style.getPropertyValue("--rm-toast-clearance"),
    ).toBe("72px");
    composer.remove();
  });

  it("copyToClipboard confirms success and reports a blocked clipboard", async () => {
    render(<Toaster />);
    const writeText = vi.fn().mockResolvedValueOnce(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    await act(async () => {
      expect(await copyToClipboard("abc", "User ID copied")).toBe(true);
    });
    expect(writeText).toHaveBeenCalledWith("abc");
    expect(await screen.findByText("User ID copied")).toBeInTheDocument();

    writeText.mockRejectedValueOnce(new Error("NotAllowedError"));
    await act(async () => {
      expect(await copyToClipboard("abc")).toBe(false);
    });
    expect(await screen.findByText(/Couldn't copy/)).toBeInTheDocument();
  });
});
