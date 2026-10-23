// ============================================================================
// AudioDeviceMenu — context menu for the mic/headphone caret buttons
//
// mode="input"  → input device list + input volume + Voice Settings shortcut
// mode="output" → output device list + output volume + Voice Settings shortcut
//
// Uses createPortal to render at document.body level, avoiding overflow
// clipping from sidebar containers. Submenu position is calculated
// dynamically using getBoundingClientRect to avoid overlap + viewport clipping.
// ============================================================================

import { useMounted } from "@/hooks/useMounted";
import { useMediaDevices } from "@/lib/useMediaDevices";
import { cn } from "@/lib/utils";
import { useVoiceSettingsStore } from "@/stores/useVoiceSettingsStore";
import { useUser } from "@kova/react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useShallow } from "zustand/shallow";
import { Icon } from "@/components/ui/icon";

interface AudioDeviceMenuProps {
  mode: "input" | "output";
  onClose: () => void;
  onOpenVoiceSettings: () => void;
  /** Anchor element to position near */
  anchorRef: React.RefObject<HTMLElement | null>;
}

export function AudioDeviceMenu({
  mode,
  onClose,
  onOpenVoiceSettings,
  anchorRef,
}: AudioDeviceMenuProps) {
  const mounted = useMounted();
  const { user } = useUser();
  const settingsUserId = user?.id ?? null;
  const { audioInputs, audioOutputs } = useMediaDevices();
  const vSettings = useVoiceSettingsStore(
    useShallow((s) => s.getSettings(settingsUserId)),
  );
  const setDevice = useVoiceSettingsStore((s) => s.setDevice);
  const updateUserSettings = useVoiceSettingsStore((s) => s.updateUserSettings);

  const [showDeviceSubmenu, setShowDeviceSubmenu] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });
  const [submenuPos, setSubmenuPos] = useState({ top: 0, left: 0 });
  const menuRef = useRef<HTMLDivElement>(null);
  const deviceRowRef = useRef<HTMLButtonElement>(null);
  const submenuTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const defaultInput = audioInputs.find((d) => d.deviceId === "default");
  const defaultOutput = audioOutputs.find((d) => d.deviceId === "default");
  const devices =
    mode === "input"
      ? [
          {
            deviceId: "default",
            label: defaultInput?.label || "Default Microphone",
            groupId: defaultInput?.groupId,
            kind: "audioinput" as MediaDeviceKind,
          },
          ...audioInputs.filter((d) => d.deviceId !== "default"),
        ]
      : [
          {
            deviceId: "default",
            label: defaultOutput?.label || "Default Speaker",
            groupId: defaultOutput?.groupId,
            kind: "audiooutput" as MediaDeviceKind,
          },
          ...audioOutputs.filter((d) => d.deviceId !== "default"),
        ];

  const currentDeviceId =
    mode === "input" ? vSettings.inputDeviceId : vSettings.outputDeviceId;
  const volume =
    mode === "input" ? vSettings.inputVolume : vSettings.outputVolume;

  // Position main menu above anchor
  useLayoutEffect(() => {
    if (!anchorRef.current || !menuRef.current) return;
    const anchorRect = anchorRef.current.getBoundingClientRect();
    const menuHeight = menuRef.current.offsetHeight;

    setMenuPos({
      top: anchorRect.top - menuHeight - 8,
      left: anchorRect.left,
    });
  }, [anchorRef]);

  // Position submenu to the right of the device row, clamped to viewport
  const updateSubmenuPos = useCallback(() => {
    if (!deviceRowRef.current || !menuRef.current) return;
    const rowRect = deviceRowRef.current.getBoundingClientRect();
    const menuRect = menuRef.current.getBoundingClientRect();
    const submenuWidth = 200;
    const submenuHeight = Math.min(devices.length * 36 + 12, 252); // approx item height + padding, capped at max-h

    // Place to the right of the main menu
    let left = menuRect.right + 4;
    // If off right edge, flip to left
    if (left + submenuWidth > window.innerWidth - 8) {
      left = menuRect.left - submenuWidth - 4;
    }

    // Align top with the device row
    let top = rowRect.top;
    // If clipping below viewport, shift up
    if (top + submenuHeight > window.innerHeight - 8) {
      top = window.innerHeight - submenuHeight - 8;
    }
    // If shifted above viewport, clamp to 8
    if (top < 8) top = 8;

    setSubmenuPos({ top, left });
  }, [devices.length]);

  useLayoutEffect(() => {
    if (showDeviceSubmenu) {
      const frameId = requestAnimationFrame(updateSubmenuPos);
      return () => cancelAnimationFrame(frameId);
    }
  }, [showDeviceSubmenu, updateSubmenuPos]);

  const clearSubmenuTimer = useCallback(() => {
    const submenuTimer = submenuTimerRef.current;
    if (submenuTimer !== null) {
      submenuTimerRef.current = null;
      clearTimeout(submenuTimer);
    }
  }, []);

  // Close on outside click (delay to avoid catching the opening click)
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        // Also check if click is inside the submenu portal
        const submenuEl = document.getElementById("audio-device-submenu");
        if (submenuEl && submenuEl.contains(e.target as Node)) return;
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClick);
    }, 50);
    document.addEventListener("keydown", handleKey);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  // Cleanup hover timer
  useEffect(() => clearSubmenuTimer, [clearSubmenuTimer]);

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

  const handleDeviceHover = (entering: boolean) => {
    clearSubmenuTimer();
    if (entering) {
      submenuTimerRef.current = setTimeout(() => {
        submenuTimerRef.current = null;
        setShowDeviceSubmenu(true);
      }, 80);
    } else {
      submenuTimerRef.current = setTimeout(() => {
        submenuTimerRef.current = null;
        setShowDeviceSubmenu(false);
      }, 200);
    }
  };

  const modeIcon = mode === "input" ? "mic" : "headphones";
  const deviceLabel = mode === "input" ? "Input Device" : "Output Device";

  if (!mounted) return null;

  return createPortal(
    <>
      {/* Main menu */}
      <div
        ref={menuRef}
        className="fixed z-70 animate-in fade-in slide-in-from-bottom-2 duration-200"
        style={{ top: menuPos.top, left: menuPos.left }}
      >
        <div className="w-[220px] bg-rm-bg-floating border border-rm-border rounded-xl shadow-2xl backdrop-blur-xl">
          {/* Header */}
          <div className="px-3 py-2 border-b border-rm-border rounded-t-xl">
            <div className="flex items-center gap-2">
              <Icon name={modeIcon} size="xs" className="text-rm-text-muted" />
              <span className="text-ui-2xs font-semibold uppercase tracking-[0.08em] text-rm-text-muted">
                {mode === "input" ? "Input" : "Output"} Settings
              </span>
            </div>
          </div>

          <div className="p-1.5">
            {/* Device Selector Row */}
            <div
              onMouseEnter={() => handleDeviceHover(true)}
              onMouseLeave={() => handleDeviceHover(false)}
            >
              <button
                ref={deviceRowRef}
                onClick={() => setShowDeviceSubmenu(!showDeviceSubmenu)}
                className={cn(
                  "w-full text-left px-3 py-2 text-ui-xs font-medium rounded-lg transition-colors flex items-center justify-between group",
                  showDeviceSubmenu
                    ? "bg-rm-accent/10 text-rm-accent"
                    : "text-rm-text pointer-fine:hover:bg-rm-bg-hover",
                )}
              >
                <span className="flex items-center gap-2 min-w-0 flex-1">
                  <Icon
                    name={modeIcon}
                    size="sm"
                    className="opacity-60 shrink-0"
                  />
                  <span className="flex flex-col min-w-0">
                    <span className="leading-tight">{deviceLabel}</span>
                    <span className="text-ui-2xs text-rm-text-muted/60 font-normal truncate leading-tight">
                      {devices.find((d) => d.deviceId === currentDeviceId)
                        ?.label ?? "Default"}
                    </span>
                  </span>
                </span>
                <Icon
                  name="chevronRight"
                  size="xs"
                  className="transition-transform duration-200 shrink-0"
                />
              </button>
            </div>

            {/* Divider */}
            <div className="h-px bg-rm-border my-1" />

            {/* Volume Slider */}
            <div className="px-3 py-2">
              <div className="flex items-center justify-between mb-2.5">
                <span className="text-ui-2xs font-semibold uppercase tracking-[0.08em] text-rm-text-muted flex items-center gap-1.5">
                  <Icon name="voiceChannel" size="xs" className="opacity-60" />
                  {mode === "input" ? "Input Volume" : "Output Volume"}
                </span>
                <span className="text-ui-2xs font-bold text-primary tabular-nums">
                  {volume}%
                </span>
              </div>
              <div className="group/slider relative h-1.5 rounded-full bg-rm-bg-primary">
                <div
                  className="absolute left-0 top-0 h-full rounded-full bg-primary transition-ui"
                  style={{
                    width: `${Math.min(100, (volume / (mode === "output" ? 200 : 100)) * 100)}%`,
                  }}
                />
                <div
                  className="pointer-events-none absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border border-rm-border bg-rm-bg-surface opacity-0 shadow-lg transition-opacity pointer-fine:group-hover/slider:opacity-100"
                  style={{
                    left: `calc(${Math.min(100, (volume / (mode === "output" ? 200 : 100)) * 100)}% - 6px)`,
                  }}
                />
                <input
                  type="range"
                  min="0"
                  max={mode === "output" ? 200 : 100}
                  step="1"
                  value={volume}
                  aria-label={
                    mode === "input" ? "Input volume" : "Output volume"
                  }
                  onChange={(e) => handleVolumeChange(parseInt(e.target.value))}
                  className="absolute inset-0 z-10 w-full h-full cursor-pointer opacity-0"
                />
              </div>
            </div>

            {/* Divider */}
            <div className="h-px bg-rm-border my-1" />

            {/* Voice Settings Link */}
            <button
              onClick={() => {
                onClose();
                onOpenVoiceSettings();
              }}
              className="w-full text-left px-3 py-2 text-ui-xs font-medium text-rm-text-muted pointer-fine:hover:text-rm-text pointer-fine:hover:bg-rm-bg-hover rounded-lg transition-colors flex items-center gap-2"
            >
              <Icon name="settings" size="sm" className="opacity-60" />
              Voice Settings
            </button>
          </div>
        </div>
      </div>

      {/* Device submenu — rendered as a SIBLING (not child) at body level */}
      {showDeviceSubmenu && (
        <div
          id="audio-device-submenu"
          className="fixed z-80 animate-in fade-in slide-in-from-left-2 duration-150"
          style={{ top: submenuPos.top, left: submenuPos.left }}
          onMouseEnter={() => handleDeviceHover(true)}
          onMouseLeave={() => handleDeviceHover(false)}
        >
          <div className="w-[200px] bg-rm-bg-floating border border-rm-border rounded-xl shadow-2xl backdrop-blur-xl">
            <div className="p-1.5 max-h-[240px] overflow-y-auto custom-scrollbar">
              {devices.map((device) => {
                const isSelected = device.deviceId === currentDeviceId;
                return (
                  <button
                    key={device.deviceId}
                    onClick={() => handleDeviceSelect(device.deviceId)}
                    className={cn(
                      "w-full text-left px-3 py-2 text-ui-2xs font-medium rounded-lg transition-ui flex items-center gap-2",
                      isSelected
                        ? "bg-rm-accent/10 text-rm-accent"
                        : "text-rm-text-muted pointer-fine:hover:bg-rm-bg-hover pointer-fine:hover:text-rm-text",
                    )}
                  >
                    <div
                      className={cn(
                        "w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors",
                        isSelected
                          ? "border-rm-accent bg-rm-accent"
                          : "border-rm-text-muted/30",
                      )}
                    >
                      {isSelected && (
                        <Icon name="check" size="xs" className="text-white" />
                      )}
                    </div>
                    <span className="truncate">{device.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>,
    document.body,
  );
}
