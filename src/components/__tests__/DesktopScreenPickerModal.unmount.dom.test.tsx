// @vitest-environment jsdom

import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { DesktopScreenPickerModal } from "../DesktopScreenPickerModal";

vi.mock("@/hooks/useMediaQuery", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useMediaQuery")>()),
  useIsMobile: () => true,
}));

vi.mock("@/stores/useVoiceSettingsStore", () => ({
  useVoiceSettingsStore: (selector: (state: unknown) => unknown) =>
    selector({
      getSettings: () => ({
        screenShareQuality: "1080p30",
        screenShareWithAudio: false,
      }),
      setScreenShareDefaults: () => {},
    }),
}));

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const windowSource = (id: string) => ({
  id,
  name: `Window ${id}`,
  kind: "window",
  thumbnail: "",
  app_name: "App",
});

it("stops a thumbnail batch once the picker unmounts", async () => {
  let resolveFirst: (value: string) => void = () => {};
  const first = new Promise<string>((resolve) => {
    resolveFirst = resolve;
  });
  const invoke = vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
    if (cmd === "get_screen_sources") {
      return [windowSource("w-1"), windowSource("w-2")];
    }
    if (cmd === "get_source_thumbnail") {
      return args?.sourceId === "w-1" ? first : "data:image/png;base64,BBBB";
    }
    return "";
  });
  const thumbnailCalls = () =>
    invoke.mock.calls.filter(([cmd]) => cmd === "get_source_thumbnail");

  const { unmount } = render(
    <DesktopScreenPickerModal
      isOpen
      onClose={() => {}}
      onStart={() => {}}
      availableQualities={["1080p30"]}
      invoke={invoke}
    />,
  );
  // The batch is now parked on the first (deferred) thumbnail.
  await waitFor(() => expect(thumbnailCalls()).toHaveLength(1));
  expect(thumbnailCalls()[0][1]).toEqual({ sourceId: "w-1" });

  unmount();
  resolveFirst("data:image/png;base64,AAAA");
  // Longer than the 120 ms pause between batch items.
  await new Promise((resolve) => setTimeout(resolve, 400));

  expect(thumbnailCalls()).toHaveLength(1);
});
