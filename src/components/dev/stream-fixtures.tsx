/**
 * Dev-only screen share fixtures (mounted by UiFixtures), each open over the
 * chat shell so they can be shot at 360 / 390 / 768 / 1280.
 *
 *   st-share-web              browser share (quality + audio, then getDisplayMedia)
 *   st-share-desktop          desktop app picker with stubbed windows/screens
 *   st-share-desktop-empty    desktop app picker, nothing to share
 *   st-share-unsupported      phone browser: explains sharing isn't available
 *   st-share-unsupported-app  Tauri phone app: same, app copy
 */

import { DesktopScreenPickerModal } from "@/components/DesktopScreenPickerModal";
import { ScreenShareModal } from "@/components/ScreenShareModal";
import { UnifiedScreenShareModal } from "@/components/UnifiedScreenShareModal";
import shareFrame from "@/components/dev/assets/share-frame.webp";
import coverGlasshouse from "@/components/dev/assets/cover-glasshouse.webp";
import coverNightdrive from "@/components/dev/assets/cover-nightdrive.webp";
import type { ScreenSource } from "@/components/DesktopScreenPickerUI";
import type { ReactNode } from "react";

const QUALITIES = [
  "720p30",
  "720p60",
  "1080p30",
  "1080p60",
  "1440p30",
  "1440p60",
  "4k30",
  "4k60",
];
const noop = () => {};

const SOURCES: ScreenSource[] = [
  {
    id: "w-1",
    name: "Ralph Meet — design-system",
    kind: "window",
    thumbnail: "",
    app_name: "Ralph Meet",
  },
  {
    id: "w-2",
    name: "Figma — Quiet Pro components",
    kind: "window",
    thumbnail: "",
    app_name: "Figma",
  },
  {
    id: "w-3",
    name: "Visual Studio Code — useVoiceChannel.ts",
    kind: "window",
    thumbnail: "",
    app_name: "Code",
  },
  {
    id: "m-1",
    name: "Display 1 (2560×1440)",
    kind: "monitor",
    thumbnail: "",
    app_name: "",
  },
  {
    id: "m-2",
    name: "Display 2 (1920×1080)",
    kind: "monitor",
    thumbnail: "",
    app_name: "",
  },
];

const THUMBS: Record<string, string> = {
  "w-1": shareFrame,
  "w-2": coverGlasshouse,
  "w-3": coverNightdrive,
  "m-1": shareFrame,
  "m-2": coverGlasshouse,
};

function stubInvoke(empty: boolean) {
  return async (cmd: string, args?: Record<string, unknown>) => {
    if (cmd === "get_screen_sources") return empty ? [] : SOURCES;
    if (cmd === "get_source_thumbnail") {
      return THUMBS[String(args?.sourceId ?? "")] ?? "";
    }
    return null;
  };
}

export function StreamFixture({
  surface,
  shell,
}: {
  surface: string;
  shell: ReactNode;
}) {
  let overlay: ReactNode = null;
  switch (surface) {
    case "st-share-web":
      overlay = (
        <ScreenShareModal
          isOpen
          onClose={noop}
          onStart={noop}
          availableQualities={QUALITIES}
        />
      );
      break;
    case "st-share-desktop":
    case "st-share-desktop-empty":
      overlay = (
        <DesktopScreenPickerModal
          isOpen
          onClose={noop}
          onStart={noop}
          availableQualities={QUALITIES}
          invoke={stubInvoke(surface === "st-share-desktop-empty")}
        />
      );
      break;
    case "st-share-unsupported":
    case "st-share-unsupported-app":
      overlay = (
        <UnifiedScreenShareModal
          isOpen
          onClose={noop}
          onStart={noop}
          availableQualities={QUALITIES}
          support={{
            supported: false,
            reason:
              surface === "st-share-unsupported-app"
                ? "mobile-app"
                : "mobile-browser",
          }}
        />
      );
      break;
    default:
      overlay = (
        <p className="p-6 text-ui-sm text-rm-text">Unknown surface {surface}</p>
      );
  }
  return (
    <div className="relative h-full w-full">
      {shell}
      {overlay}
    </div>
  );
}
