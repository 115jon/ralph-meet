// ============================================================================
// AudioDeviceMenu — the menu behind the mic/headphone caret buttons
//
// mode="input"  → input device list + input volume + Voice settings shortcut
// mode="output" → output device list + output volume + Voice settings shortcut
//
// Desktop: a DropdownMenu anchored to the caret (design-system 12.7), the
// device list in a submenu that flips when there is no room. Phones: the same
// items in an ActionSheet (13.1). The host mounts this only while it is open
// and unmounts it from `onClose`.
// ============================================================================

import { useUser } from "@kova/react";
import { useShallow } from "zustand/shallow";

import { ActionSheet } from "@/components/ui/action-sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/ui/icon";
import {
  MENU_ITEM,
  MENU_ITEM_DEFAULT,
  MENU_ITEM_DEFAULT_ON,
} from "@/components/ui/menu";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { useMediaDevices } from "@/lib/useMediaDevices";
import { cn } from "@/lib/utils";
import { useVoiceSettingsStore } from "@/stores/useVoiceSettingsStore";

interface AudioDeviceMenuProps {
  mode: "input" | "output";
  onClose: () => void;
  onOpenVoiceSettings: () => void;
  /** The caret the menu is anchored to (it also toggles the menu). */
  anchorRef: React.RefObject<HTMLElement | null>;
}

/** Keys the range input keeps for itself instead of the menu's roving focus. */
const SLIDER_KEYS = new Set([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
  "PageUp",
  "PageDown",
]);

function VolumeSlider({
  mode,
  volume,
  onChange,
}: {
  mode: "input" | "output";
  volume: number;
  onChange: (value: number) => void;
}) {
  const max = mode === "output" ? 200 : 100;
  const fill = Math.min(100, (volume / max) * 100);
  const label = mode === "input" ? "Input volume" : "Output volume";

  return (
    <div className="px-2 pt-1.5 pb-2.5">
      <div className="mb-2 flex items-center justify-between text-ui-xs font-medium text-rm-text-muted">
        <span>{label}</span>
        <span className="text-rm-text tabular-nums">{volume}%</span>
      </div>
      <div className="relative flex h-3 items-center pointer-coarse:h-11">
        <div className="relative h-1.5 w-full rounded-full bg-rm-tint-2">
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-primary"
            style={{ width: `${fill}%` }}
          />
          <div
            className="pointer-events-none absolute top-1/2 size-3 -translate-y-1/2 rounded-full border border-rm-border bg-rm-bg-surface shadow-sm pointer-coarse:size-5"
            style={{ left: `calc(${fill}% - 6px)` }}
          />
        </div>
        <input
          type="range"
          min="0"
          max={max}
          step="1"
          value={volume}
          aria-label={mode === "input" ? "Input volume" : "Output volume"}
          onChange={(event) => onChange(parseInt(event.target.value, 10))}
          onKeyDown={(event) => {
            if (SLIDER_KEYS.has(event.key)) event.stopPropagation();
          }}
          className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
        />
      </div>
    </div>
  );
}

export function AudioDeviceMenu({
  mode,
  onClose,
  onOpenVoiceSettings,
  anchorRef,
}: AudioDeviceMenuProps) {
  const isMobile = useIsMobile();
  const { user } = useUser();
  const settingsUserId = user?.id ?? null;
  const { audioInputs, audioOutputs } = useMediaDevices();
  const vSettings = useVoiceSettingsStore(
    useShallow((s) => s.getSettings(settingsUserId)),
  );
  const setDevice = useVoiceSettingsStore((s) => s.setDevice);
  const updateUserSettings = useVoiceSettingsStore((s) => s.updateUserSettings);

  const defaultInput = audioInputs.find((d) => d.deviceId === "default");
  const defaultOutput = audioOutputs.find((d) => d.deviceId === "default");
  const devices =
    mode === "input"
      ? [
          {
            deviceId: "default",
            label: defaultInput?.label || "Default microphone",
            groupId: defaultInput?.groupId,
          },
          ...audioInputs.filter((d) => d.deviceId !== "default"),
        ]
      : [
          {
            deviceId: "default",
            label: defaultOutput?.label || "Default speaker",
            groupId: defaultOutput?.groupId,
          },
          ...audioOutputs.filter((d) => d.deviceId !== "default"),
        ];

  const currentDeviceId =
    mode === "input" ? vSettings.inputDeviceId : vSettings.outputDeviceId;
  const currentDeviceLabel =
    devices.find((d) => d.deviceId === currentDeviceId)?.label ?? "Default";
  const volume =
    mode === "input" ? vSettings.inputVolume : vSettings.outputVolume;

  const handleDeviceSelect = (deviceId: string) => {
    const device = devices.find((d) => d.deviceId === deviceId);
    setDevice(mode, deviceId, settingsUserId ?? undefined, {
      label: device?.label,
      groupId: device?.groupId,
    });
  };

  const handleVolumeChange = (val: number) => {
    const key = mode === "input" ? "inputVolume" : "outputVolume";
    updateUserSettings(
      (s) => ({ ...s, [key]: val }),
      settingsUserId ?? undefined,
    );
  };

  const modeIcon = mode === "input" ? "mic" : "headphones";
  const title = mode === "input" ? "Input settings" : "Output settings";
  const deviceLabel = mode === "input" ? "Input device" : "Output device";

  if (isMobile) {
    return (
      <ActionSheet
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
        title={title}
        showTitle
        header={
          <VolumeSlider
            mode={mode}
            volume={volume}
            onChange={handleVolumeChange}
          />
        }
        items={[
          {
            key: "device",
            label: deviceLabel,
            subtitle: currentDeviceLabel,
            icon: <Icon name={modeIcon} />,
            onClick: () => {},
            closeOnClick: false,
            submenu: (
              <div role="radiogroup" aria-label={deviceLabel}>
                {devices.map((device) => {
                  const selected = device.deviceId === currentDeviceId;
                  return (
                    <button
                      key={device.deviceId}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => handleDeviceSelect(device.deviceId)}
                      className={cn(
                        MENU_ITEM,
                        selected ? MENU_ITEM_DEFAULT_ON : MENU_ITEM_DEFAULT,
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {device.label}
                      </span>
                      {selected ? <Icon name="check" size="xs" /> : null}
                    </button>
                  );
                })}
              </div>
            ),
          },
          {
            key: "voice-settings",
            label: "Voice settings",
            icon: <Icon name="settings" />,
            onClick: onOpenVoiceSettings,
          },
        ]}
      />
    );
  }

  return (
    <DropdownMenu
      open
      modal={false}
      onOpenChange={(open) => {
        // A press on the caret is not an outside press (the menu ignores
        // presses on its anchor), so the caret's own click toggles it.
        if (!open) onClose();
      }}
    >
      <DropdownMenuContent
        anchor={anchorRef}
        side="top"
        align="start"
        sideOffset={8}
        finalFocus={anchorRef}
        aria-label={title}
        className="w-60"
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel>{title}</DropdownMenuLabel>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger icon={<Icon name={modeIcon} />}>
              <span className="flex min-w-0 flex-col">
                <span className="truncate">{deviceLabel}</span>
                <span className="truncate text-ui-xs font-normal text-rm-text-muted">
                  {currentDeviceLabel}
                </span>
              </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent aria-label={deviceLabel}>
              <DropdownMenuRadioGroup
                value={currentDeviceId}
                onValueChange={(value: string) => handleDeviceSelect(value)}
              >
                {devices.map((device) => (
                  <DropdownMenuRadioItem
                    key={device.deviceId}
                    value={device.deviceId}
                  >
                    {device.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <VolumeSlider
          mode={mode}
          volume={volume}
          onChange={handleVolumeChange}
        />
        <DropdownMenuSeparator />
        <DropdownMenuItem
          icon={<Icon name="settings" />}
          onClick={onOpenVoiceSettings}
        >
          Voice settings
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
