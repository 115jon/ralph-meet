/**
 * Pieces of the desktop app's screen picker (DesktopScreenPickerModal), drawn
 * inside ScreenSharePickerShell. Everything sizes from its container, so the
 * picker reads the same in a 860px dialog and a 360px phone-width window: the
 * grids drop to one column and the tabs scroll sideways.
 */

import type { ReactNode } from "react";

import { Icon, type IconName } from "@/components/ui/icon";
import { EmptyState } from "@/components/ui/empty-state";
import { Tabs } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export interface ScreenSource {
  id: string;
  capture_id?: string;
  name: string;
  kind: "window" | "monitor";
  thumbnail: string;
  app_name: string;
  /** base64 PNG data URL of the window's app icon ("" for monitors / no icon). */
  icon?: string;
}

export interface MediaDeviceSource {
  deviceId: string;
  label: string;
}

export type Tab = "applications" | "screens" | "devices";

const GRID =
  "grid grid-cols-1 gap-3 @min-[440px]:grid-cols-2 @min-[680px]:grid-cols-3";

/**
 * A source tile: ply-2 with a line edge. Selected draws a 2px accent-ink
 * border over the edge (an overlay, so nothing shifts and the focus ring
 * stays separate); no accent fill.
 */
const TILE =
  "group relative flex flex-col overflow-hidden rounded-lg border bg-ply-2 text-left outline-none transition-[border-color] duration-(--dur-1) ease-out after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:border-2 after:border-transparent";

function tileState(selected: boolean) {
  return selected
    ? "border-transparent after:border-accent-ink"
    : "border-line pointer-fine:hover:border-line-strong";
}

/** The check badge: ply-3 with accent-ink glyph, above the border overlay. */
function SelectedMark() {
  return (
    <span className="absolute top-2 right-2 z-10 flex size-6 items-center justify-center rounded-full border border-line bg-ply-3 text-accent-ink">
      <Icon name="check" size="xs" />
    </span>
  );
}

export function PickerEmpty({
  title,
  body,
  action,
}: {
  /** Kept for existing call sites; the empty state draws the screen glyph. */
  icon?: IconName;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <EmptyState
      size="sm"
      motif="screen"
      title={title}
      description={body}
      action={action}
    />
  );
}

export function DeviceGrid({
  devices,
  selectedId,
  onSelect,
}: {
  devices: MediaDeviceSource[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (devices.length === 0) {
    return (
      <PickerEmpty
        title="No capture devices found"
        body="Connect a capture card or camera to share it."
      />
    );
  }
  return (
    <div role="radiogroup" aria-label="Capture devices" className={GRID}>
      {devices.map((device) => {
        const selected = selectedId === device.deviceId;
        return (
          <button
            key={device.deviceId}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onSelect(device.deviceId)}
            className={cn(TILE, tileState(selected))}
          >
            <span className="flex aspect-video w-full items-center justify-center bg-tint-1">
              <Icon
                name="tv"
                size="2xl"
                className={selected ? "text-ink-1" : "text-ink-3"}
              />
            </span>
            <span className="flex min-h-11 items-center gap-2 px-3 py-2">
              <span className="truncate text-ui-sm font-medium text-ink-1">
                {device.label}
              </span>
            </span>
            {selected ? <SelectedMark /> : null}
          </button>
        );
      })}
    </div>
  );
}

export function SourceGrid({
  sources,
  thumbnails,
  selectedId,
  onSelect,
  onPreview,
}: {
  sources: ScreenSource[];
  thumbnails: Record<string, string>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onPreview: (id: string) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Sources" className={GRID}>
      {sources.map((source) => {
        const thumb = thumbnails[source.id];
        const selected = selectedId === source.id;
        return (
          <button
            key={source.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onSelect(source.id)}
            onFocus={() => onPreview(source.id)}
            onPointerEnter={() => onPreview(source.id)}
            className={cn(TILE, tileState(selected))}
          >
            <span className="relative block aspect-video w-full overflow-hidden bg-tint-1">
              {thumb ? (
                <img
                  src={thumb}
                  alt=""
                  className="size-full object-contain"
                  draggable={false}
                />
              ) : (
                <span className="flex size-full items-center justify-center">
                  <Icon
                    name={source.kind === "monitor" ? "monitor" : "window"}
                    size="xl"
                    className="text-ink-3"
                  />
                </span>
              )}
            </span>
            <span className="flex min-h-11 items-center gap-2 px-3 py-2">
              {source.kind === "window" && source.icon ? (
                <img
                  src={source.icon}
                  alt=""
                  className="size-4 shrink-0 object-contain"
                  draggable={false}
                />
              ) : (
                <Icon
                  name={source.kind === "monitor" ? "monitor" : "window"}
                  size="sm"
                  className="shrink-0 text-ink-3"
                />
              )}
              <span className="truncate text-ui-sm font-medium text-ink-1">
                {source.name}
              </span>
            </span>
            {selected ? <SelectedMark /> : null}
          </button>
        );
      })}
    </div>
  );
}

const TABS = [
  { value: "applications", label: "Applications" },
  { value: "screens", label: "Entire screen" },
  { value: "devices", label: "Devices" },
] as const satisfies ReadonlyArray<{ value: Tab; label: string }>;

/** Id base for the tab list, so the source area can name itself after the tab. */
export const SCREEN_PICKER_TABS_ID = "screen-picker";
export const SCREEN_PICKER_PANEL_ID = "screen-picker-panel";

/**
 * Underline tabs (spec §7). The wrapper insets the list by 20px and the list
 * adds 4px of its own, so tab text starts at the 24px title inset and the
 * 2px focus ring (offset 2) has room inside the sideways-scrolling list
 * instead of being clipped to two vertical bars.
 */
export function DesktopScreenPickerTabBar({
  tab,
  setTab,
}: {
  tab: Tab;
  setTab: (t: Tab) => void;
}) {
  return (
    <div className="shrink-0 border-b border-line px-3 md:px-5">
      <Tabs
        label="What to share"
        items={TABS}
        value={tab}
        onValueChange={setTab}
        idBase={SCREEN_PICKER_TABS_ID}
        panelId={SCREEN_PICKER_PANEL_ID}
        scrollable
        className="h-11 px-1 py-1 md:h-10"
      />
    </div>
  );
}
