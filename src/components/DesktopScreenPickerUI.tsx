/**
 * Pieces of the desktop app's screen picker (DesktopScreenPickerModal).
 * Everything sizes from its container, so the picker reads the same in a
 * 860px dialog and a 360px phone-width window: the grids drop to one column,
 * the tabs scroll sideways, and the bottom bar stacks.
 */

import { Button } from "@/components/ui/button";
import { Icon, type IconName } from "@/components/ui/icon";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  SCREEN_SHARE_QUALITY_PRESETS,
  type ScreenShareQualityPreset,
} from "@/lib/screen-share-support";
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

export const QUALITY_PRESETS = SCREEN_SHARE_QUALITY_PRESETS;

const GRID =
  "grid grid-cols-1 gap-3 @min-[440px]:grid-cols-2 @min-[680px]:grid-cols-3";

const TILE =
  "group relative flex flex-col overflow-hidden rounded-lg border bg-rm-bg-surface text-left outline-none transition-[border-color,background-color] duration-150 ease-(--rm-ease-out)";

function tileState(selected: boolean) {
  return selected
    ? "border-rm-accent-ink/60 bg-rm-accent-tint"
    : "border-rm-border pointer-fine:hover:border-rm-border-strong pointer-fine:hover:bg-rm-tint-1";
}

function SelectedMark() {
  return (
    <span className="absolute top-2 right-2 flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground">
      <Icon name="check" size="xs" />
    </span>
  );
}

export function PickerEmpty({
  icon,
  title,
  body,
}: {
  icon: IconName;
  title: string;
  body?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      <Icon name={icon} size="3xl" className="text-rm-text-muted" />
      <p className="text-ui-md font-semibold text-rm-text">{title}</p>
      {body ? (
        <p className="max-w-[36ch] text-pretty text-ui-sm text-rm-text-secondary">
          {body}
        </p>
      ) : null}
    </div>
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
        icon="tv"
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
            <span className="flex aspect-video w-full items-center justify-center bg-rm-tint-1">
              <Icon
                name="tv"
                size="2xl"
                className={
                  selected ? "text-rm-accent-ink" : "text-rm-text-muted"
                }
              />
            </span>
            <span className="flex min-h-11 items-center gap-2 px-3 py-2">
              <span className="truncate text-ui-sm font-medium text-rm-text">
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
            <span className="relative block aspect-video w-full overflow-hidden bg-rm-tint-2">
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
                    className="text-rm-text-muted"
                  />
                </span>
              )}
              {selected ? <SelectedMark /> : null}
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
                  className="shrink-0 text-rm-text-muted"
                />
              )}
              <span className="truncate text-ui-sm font-medium text-rm-text">
                {source.name}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

const TABS = [
  { key: "applications", icon: "window", label: "Applications" },
  { key: "screens", icon: "monitor", label: "Entire screen" },
  { key: "devices", icon: "tv", label: "Devices" },
] as const satisfies ReadonlyArray<{ key: Tab; icon: string; label: string }>;

export function DesktopScreenPickerTabBar({
  tab,
  setTab,
}: {
  tab: Tab;
  setTab: (t: Tab) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="What to share"
      className="scrollbar-none flex shrink-0 overflow-x-auto border-b border-rm-border px-2 md:px-4"
    >
      {TABS.map((t) => {
        const active = tab === t.key;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => setTab(t.key)}
            className={cn(
              "relative flex min-h-11 shrink-0 items-center gap-2 px-3 text-ui-sm whitespace-nowrap transition-colors md:min-h-10",
              active
                ? "font-semibold text-rm-text"
                : "font-medium text-rm-text-secondary pointer-fine:hover:text-rm-text",
            )}
          >
            <Icon name={t.icon} size="sm" />
            {t.label}
            {active ? (
              <span
                aria-hidden
                className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-rm-text"
              />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function DesktopScreenPickerBottomBar({
  displayName,
  selectedQ,
  qualities,
  selectedQuality,
  setQuality,
  withAudio,
  toggleAudio,
  onClose,
  onStart,
  selectedId,
}: {
  displayName: string;
  selectedQ: Pick<ScreenShareQualityPreset, "label" | "fps"> | undefined;
  qualities: readonly ScreenShareQualityPreset[];
  selectedQuality: string;
  setQuality: (q: string) => void;
  withAudio: boolean;
  toggleAudio: () => void;
  onClose: () => void;
  onStart: () => void;
  selectedId: string | null;
}) {
  return (
    <div className="@container shrink-0 border-t border-rm-border px-4 pt-3 pb-[max(12px,var(--safe-area-bottom,0px))] md:px-6 md:pb-4">
      <div className="flex flex-col gap-3 @min-[640px]:flex-row @min-[640px]:items-center">
        <div className="min-w-0 @min-[640px]:flex-1">
          <p className="truncate text-ui-sm font-semibold text-rm-text">
            {displayName}
          </p>
          <p className="text-ui-xs text-rm-text-secondary">
            {selectedQ?.label ?? "720p"} · {selectedQ?.fps ?? 30} FPS
            {withAudio ? " · with audio" : ""}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Select value={selectedQuality} onValueChange={setQuality}>
            <SelectTrigger
              aria-label="Select stream quality"
              className="h-9 min-w-0 flex-1 text-ui-sm pointer-coarse:min-h-11 @min-[640px]:w-40 @min-[640px]:flex-none"
            >
              <SelectValue placeholder="Select quality" />
            </SelectTrigger>
            <SelectContent position="popper" align="start">
              {qualities.map((quality) => (
                <SelectItem
                  key={quality.id}
                  value={quality.id}
                  textValue={`${quality.label} ${quality.fps} FPS`}
                >
                  {quality.label} · {quality.fps} FPS
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            type="button"
            variant="secondary"
            aria-pressed={withAudio}
            onClick={toggleAudio}
            className={cn(
              "h-9 shrink-0 pointer-coarse:min-h-11",
              withAudio && "bg-rm-accent-tint text-rm-accent-ink",
            )}
          >
            <Icon name="music" size="sm" />
            Share audio
          </Button>
        </div>

        <div className="flex flex-col-reverse gap-2 @min-[440px]:flex-row @min-[440px]:justify-end">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            className="pointer-coarse:min-h-11"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={onStart}
            disabled={!selectedId}
            className="pointer-coarse:min-h-11"
          >
            Go live
          </Button>
        </div>
      </div>
    </div>
  );
}
