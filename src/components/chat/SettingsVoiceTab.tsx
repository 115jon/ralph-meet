import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useMediaDevices } from "@/lib/useMediaDevices";
import { cn } from "@/lib/utils";
import { useVoiceSettingsStore } from "@/stores/useVoiceSettingsStore";
import { useUser } from "@clerk/tanstack-react-start";
import { Check, ChevronDown, Mic, Music, ShieldCheck, Speaker, Volume2, Zap } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/shallow";
import { SettingsSwitch } from "./SettingsSwitch";

function CustomSelect({
  value,
  onChange,
  options,
  placeholder = "Select an option",
}: {
  value: string;
  onChange: (val: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedOption = options.find((o) => o.value === value);

  useEffect(() => {
    const clickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", clickOutside);
    return () => document.removeEventListener("mousedown", clickOutside);
  }, []);

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between rounded-xl border border-rm-border bg-rm-bg-elevated/50 px-4 py-3 text-sm text-rm-text outline-none transition-all hover:bg-rm-bg-elevated focus:border-primary/40"
      >
        <span className="truncate">{selectedOption?.label || placeholder}</span>
        <ChevronDown
          size={16}
          className={cn(
            "text-rm-text-muted transition-transform duration-200",
            isOpen && "rotate-180",
          )}
        />
      </button>

      {isOpen && (
        <div className="absolute z-[400] mt-2 w-full animate-in fade-in slide-in-from-top-2 rounded-xl border border-rm-border bg-rm-bg-floating p-1.5 shadow-2xl duration-200">
          <div className="max-h-60 overflow-y-auto custom-scrollbar">
            {options.map((opt) => (
              <button
                key={opt.value}
                onClick={() => {
                  onChange(opt.value);
                  setIsOpen(false);
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-all text-left",
                  opt.value === value
                    ? "bg-primary text-primary-foreground"
                    : "text-rm-text-secondary hover:bg-rm-bg-elevated hover:text-rm-text",
                )}
              >
                <span className="truncate flex-1 font-medium">{opt.label}</span>
                {opt.value === value && (
                  <Check size={14} className="shrink-0" />
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function SettingsVoiceTab() {
  const { user } = useUser();
  const settingsUserId = user?.id ?? null;
  const { audioInputs, audioOutputs } = useMediaDevices();
  const vSettings = useVoiceSettingsStore(useShallow((s) => s.getSettings(settingsUserId)));
  const setDevice = useVoiceSettingsStore((s) => s.setDevice);
  const updateUserSettings = useVoiceSettingsStore((s) => s.updateUserSettings);
  const setCurrentUser = useVoiceSettingsStore((s) => s.setCurrentUser);

  useEffect(() => {
    const initStore = () => {
      if (settingsUserId) {
        const storeUser = useVoiceSettingsStore.getState().currentUser;
        if (!storeUser || !storeUser.startsWith('room-')) {
          setCurrentUser(settingsUserId);
        }
      }
    };
    initStore();
  }, [settingsUserId, setCurrentUser]);

  const handleVoiceToggle = (key: string) => {
    updateUserSettings((s: any) => {
      const newVal = !s[key];
      const updates: any = { [key]: newVal };

      if (key === "streamHighFidelity" && newVal) {
        updates.echoCancellation = false;
        updates.noiseSuppression = false;
        updates.autoSensitivity = false;
      }

      if (
        (key === "echoCancellation" ||
          key === "noiseSuppression" ||
          key === "autoSensitivity") &&
        newVal
      ) {
        updates.streamHighFidelity = false;
      }

      return { ...s, ...updates };
    }, settingsUserId ?? undefined);
  };

  const handleVoiceSlider = (key: string, val: number) => {
    updateUserSettings((s: any) => ({ ...s, [key]: val }), settingsUserId ?? undefined);
  };

  const filteredAudioInputs = audioInputs.filter(d => d.deviceId !== 'default');
  const filteredAudioOutputs = audioOutputs.filter(d => d.deviceId !== 'default');

  return (
    <div className="animate-in fade-in slide-in-from-right-4 duration-300">
      <h1 className="text-2xl font-bold text-rm-text mb-2 hidden md:block">
        Voice & Video
      </h1>
      <p className="text-sm text-rm-text-muted mb-6 md:mb-10">
        Configure your media devices and audio processing preferences.
      </p>

      <div className="space-y-12">
        <section className="space-y-6">
          <div className="flex items-center gap-2">
            <ShieldCheck size={16} className="text-indigo-400" />
            <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-rm-text-muted">
              Hardware Selection
            </h3>
          </div>
          <div className="bg-rm-bg-surface border border-rm-border rounded-xl flex flex-col divide-y divide-rm-border">
            <div className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 hover:bg-rm-bg-elevated/20 transition-colors">
              <Label className="text-[11px] font-bold uppercase tracking-wider text-rm-text-muted shrink-0 w-[120px]">
                Input Device
              </Label>
              <div className="flex-1 w-full max-w-full md:max-w-[280px]">
                <CustomSelect
                  value={vSettings.inputDeviceId}
                  onChange={(val) => setDevice("input", val, settingsUserId ?? undefined)}
                  options={[
                    { value: "default", label: "Default" },
                    ...filteredAudioInputs.map((d) => ({
                      value: d.deviceId,
                      label: d.label || `Microphone ${d.deviceId.slice(0, 5)}`,
                    })),
                  ]}
                />
              </div>
            </div>
            <div className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 hover:bg-rm-bg-elevated/20 transition-colors">
              <Label className="text-[11px] font-bold uppercase tracking-wider text-rm-text-muted shrink-0 w-[120px]">
                Output Device
              </Label>
              <div className="flex-1 w-full max-w-full md:max-w-[280px]">
                <CustomSelect
                  value={vSettings.outputDeviceId}
                  onChange={(val) => setDevice("output", val, settingsUserId ?? undefined)}
                  options={[
                    { value: "default", label: "Default" },
                    ...filteredAudioOutputs.map((d) => ({
                      value: d.deviceId,
                      label: d.label || `Speaker ${d.deviceId.slice(0, 5)}`,
                    })),
                  ]}
                />
              </div>
            </div>
          </div>
        </section>

        <Separator className="bg-rm-border" />

        <section className="space-y-6">
          <div className="flex items-center gap-2">
            <Volume2 size={16} className="text-emerald-400" />
            <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-rm-text-muted">
              Volume & Levels
            </h3>
          </div>
          <div className="bg-rm-bg-surface border border-rm-border rounded-xl flex flex-col p-4 gap-6">
            <div className="space-y-4">
              <div className="flex justify-between items-end px-1">
                <label htmlFor="output-volume" className="text-[11px] font-bold uppercase tracking-wider text-rm-text-muted">
                  Output Volume
                </label>
                <span className="text-sm font-black text-indigo-400 tabular-nums">
                  {vSettings.outputVolume}%
                </span>
              </div>
              <input
                id="output-volume"
                type="range"
                min="0"
                max="200"
                value={vSettings.outputVolume}
                onChange={(e) => handleVoiceSlider("outputVolume", parseInt(e.target.value))}
                className="w-full h-1.5 bg-rm-bg-elevated rounded-full appearance-none cursor-pointer accent-indigo-500 hover:accent-indigo-400 transition-all"
              />
            </div>
            {!vSettings.autoSensitivity && (
              <>
                <Separator className="bg-rm-border -mx-4 w-[calc(100%+2rem)] block max-w-none" />
                <div className="space-y-4">
                  <div className="flex justify-between items-end px-1">
                    <label htmlFor="input-sensitivity" className="text-[11px] font-bold uppercase tracking-wider text-rm-text-muted">
                      Input Sensitivity
                    </label>
                    <span className="text-sm font-black text-amber-400 tabular-nums">
                      {vSettings.sensitivity}dB
                    </span>
                  </div>
                  <input
                    id="input-sensitivity"
                    type="range"
                    min="-100"
                    max="0"
                    value={vSettings.sensitivity}
                    onChange={(e) => handleVoiceSlider("sensitivity", parseInt(e.target.value))}
                    className="w-full h-1.5 bg-rm-bg-elevated rounded-full appearance-none cursor-pointer accent-amber-500 hover:accent-amber-400 transition-all"
                  />
                </div>
              </>
            )}
          </div>
        </section>

        <Separator className="bg-rm-border" />

        <section className="space-y-6">
          <div className="flex items-center gap-2">
            <Zap size={16} className="text-amber-400" />
            <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-rm-text-muted">
              Audio Processing
            </h3>
          </div>
          <div className="flex flex-col rounded-xl overflow-hidden bg-rm-bg-surface border border-rm-border divide-y divide-rm-border">
            {[
              {
                id: "noiseSuppression",
                label: "Noise Suppression",
                desc: "Removes background noise like fans and keyboard clicks (Disables High Fidelity)",
                icon: <Mic size={18} />,
              },
              {
                id: "echoCancellation",
                label: "Echo Cancellation",
                desc: "Prevents your microphone from picking up your speakers (Disables High Fidelity)",
                icon: <Speaker size={18} />,
              },
              {
                id: "autoSensitivity",
                label: "Input Sensitivity",
                desc: "Automatically determine the best input volume level (Disables High Fidelity)",
                icon: <Volume2 size={18} />,
              },
              {
                id: "streamHighFidelity",
                label: "High Fidelity Audio",
                desc: "Disables all audio processing to allow stereo microphone input (requires headphones)",
                icon: <Music size={18} />,
              },
            ].map((opt) => (
              <div
                key={opt.id}
                className="group flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-transparent hover:bg-rm-bg-elevated/40 transition-all gap-4 sm:gap-6"
              >
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 shrink-0 rounded-xl bg-rm-bg-elevated border border-rm-border flex items-center justify-center text-rm-text-secondary group-hover:text-rm-text transition-colors">
                    {opt.icon}
                  </div>
                  <div>
                    <h4 className="text-[14px] font-bold text-rm-text">{opt.label}</h4>
                    <p className="text-[12px] text-rm-text-muted leading-snug pr-2">{opt.desc}</p>
                  </div>
                </div>
                <div className="flex justify-end w-full sm:w-auto mt-2 sm:mt-0">
                  <SettingsSwitch
                    checked={(vSettings as any)[opt.id]}
                    onChange={() => handleVoiceToggle(opt.id)}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
