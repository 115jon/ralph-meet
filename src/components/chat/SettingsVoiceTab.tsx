import { CustomSelect } from "@/components/ui/CustomSelect";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { SettingsToggleRow } from "@/components/ui/SettingsToggleRow";
import { useMediaDevices } from "@/lib/useMediaDevices";
import { useVoiceSettingsStore } from "@/stores/useVoiceSettingsStore";
import { useUser } from "@clerk/tanstack-react-start";
import { Mic, Music, ShieldCheck, Speaker, Volume2, Zap } from "lucide-react";
import { useEffect } from "react";
import { useShallow } from "zustand/shallow";
import { MicTestWidget } from "./MicTestWidget";

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
                  onChange={(val) => {
                    const device = audioInputs.find((d) => d.deviceId === val);
                    setDevice("input", val, settingsUserId ?? undefined, {
                      label: device?.label,
                      groupId: device?.groupId,
                    });
                  }}
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
                  onChange={(val) => {
                    const device = audioOutputs.find((d) => d.deviceId === val);
                    setDevice("output", val, settingsUserId ?? undefined, {
                      label: device?.label,
                      groupId: device?.groupId,
                    });
                  }}
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
            <Separator className="bg-rm-border -mx-4 w-[calc(100%+2rem)] block max-w-none" />
            <MicTestWidget
              sensitivity={vSettings.sensitivity}
              autoSensitivity={vSettings.autoSensitivity}
              inputDeviceId={vSettings.inputDeviceId}
            />
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
              <SettingsToggleRow
                key={opt.id}
                icon={opt.icon}
                label={opt.label}
                description={opt.desc}
                checked={(vSettings as any)[opt.id]}
                onChange={() => handleVoiceToggle(opt.id)}
              />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
