
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useMediaDevices } from "@/lib/useMediaDevices";
import { cn } from "@/lib/utils";
import { useVoiceSettingsStore } from "@/stores/useVoiceSettingsStore";
import {
  Mic,
  Monitor,
  Music,
  Speaker,
  Volume2,
  X,
  Zap
} from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useShallow } from "zustand/shallow";

interface RoomSettingsModalProps {
  onClose: () => void;
  settingsUserId: string;
}

type Tab = "voice" | "appearance";

export default function RoomSettingsModal({ onClose, settingsUserId }: RoomSettingsModalProps) {
  const { theme, setTheme } = useTheme();
  const [activeTab, setActiveTab] = useState<Tab>("voice");
  const [mounted, setMounted] = useState(false);

  const { audioInputs, audioOutputs } = useMediaDevices();
  const vSettings = useVoiceSettingsStore(useShallow(s => s.getSettings(settingsUserId)));
  const setDevice = useVoiceSettingsStore(s => s.setDevice);
  const updateUserSettings = useVoiceSettingsStore(s => s.updateUserSettings);

  // Filter out browser's synthetic "default" device since we add our own Default option
  const filteredAudioInputs = audioInputs.filter(d => d.deviceId !== 'default');
  const filteredAudioOutputs = audioOutputs.filter(d => d.deviceId !== 'default');

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 0);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [onClose]);

  const handleVoiceToggle = (key: string) => {
    updateUserSettings((s: any) => {
      const newVal = !s[key];
      const updates: any = { [key]: newVal };

      // High Fidelity requires ALL audio processing to be OFF to allow stereo Opus
      if (key === "streamHighFidelity" && newVal) {
        updates.echoCancellation = false;
        updates.noiseSuppression = false;
        updates.autoSensitivity = false;
      }

      // Any audio processing requires High Fidelity to be OFF (since processing downmixes to mono)
      if (
        (key === "echoCancellation" ||
          key === "noiseSuppression" ||
          key === "autoSensitivity") &&
        newVal
      ) {
        updates.streamHighFidelity = false;
      }

      return { ...s, ...updates };
    }, settingsUserId);
  };

  const handleVoiceSlider = (key: string, val: number) => {
    updateUserSettings((s: any) => ({ ...s, [key]: val }), settingsUserId);
  };

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative flex w-full max-w-[860px] max-h-[640px] rounded-xl overflow-hidden shadow-2xl bg-rm-bg-primary border border-rm-border"
        onClick={e => e.stopPropagation()}
      >
        {/* Sidebar */}
        <div className="w-[180px] flex flex-col shrink-0 bg-rm-server-bar pt-10 pb-5 pl-4 pr-1.5 overflow-y-auto">
          <div className="space-y-[2px]">
            <div className="px-2 mb-2">
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-rm-text-muted">
                Room Settings
              </h3>
            </div>
            <TabBtn active={activeTab === "voice"} onClick={() => setActiveTab("voice")} label="Voice & Video" />
            <TabBtn active={activeTab === "appearance"} onClick={() => setActiveTab("appearance")} label="Appearance" />
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col pt-10 relative overflow-hidden bg-rm-bg-primary">
          {/* Close */}
          <div className="absolute right-5 top-5 z-20 flex flex-col items-center gap-1">
            <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full border border-rm-border text-rm-text-muted hover:bg-rm-bg-hover hover:text-rm-text transition-all">
              <X size={16} />
            </button>
            <span className="text-[11px] font-bold text-rm-text-muted hidden md:block">ESC</span>
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar px-6 pb-10 max-w-[600px]">
            {activeTab === "voice" && (
              <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                <h1 className="text-xl font-bold text-rm-text mb-1">Voice & Video</h1>
                <p className="text-sm text-rm-text-muted mb-8">Configure your media devices and audio processing.</p>

                <div className="space-y-10">
                  {/* Hardware */}
                  <section className="space-y-5">
                    <div className="flex items-center gap-2">
                      <Volume2 size={14} className="text-indigo-400" />
                      <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-rm-text-muted">Hardware</h3>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                      <div className="space-y-2">
                        <Label className="text-[10px] font-bold uppercase tracking-wider text-rm-text-muted ml-1">Input Device</Label>
                        <select
                          value={vSettings.inputDeviceId}
                          onChange={e => setDevice("input", e.target.value, settingsUserId)}
                          className="w-full rounded-lg border border-rm-border bg-rm-bg-elevated px-3 py-2 text-sm text-rm-text outline-none"
                        >
                          <option value="default">Default</option>
                          {filteredAudioInputs.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || `Mic ${d.deviceId.slice(0, 5)}`}</option>)}
                        </select>
                      </div>
                      <div className="space-y-2">
                        <Label className="text-[10px] font-bold uppercase tracking-wider text-rm-text-muted ml-1">Output Device</Label>
                        <select
                          value={vSettings.outputDeviceId}
                          onChange={e => setDevice("output", e.target.value, settingsUserId)}
                          className="w-full rounded-lg border border-rm-border bg-rm-bg-elevated px-3 py-2 text-sm text-rm-text outline-none"
                        >
                          <option value="default">Default</option>
                          {filteredAudioOutputs.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || `Speaker ${d.deviceId.slice(0, 5)}`}</option>)}
                        </select>
                      </div>
                    </div>
                  </section>

                  <Separator className="bg-rm-border" />

                  {/* Volume */}
                  <section className="space-y-5">
                    <div className="flex items-center gap-2">
                      <Volume2 size={14} className="text-emerald-400" />
                      <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-rm-text-muted">Volume</h3>
                    </div>
                    <div className="space-y-4">
                      <div className="flex justify-between items-end px-1">
                        <label className="text-[10px] font-bold uppercase tracking-wider text-rm-text-muted">Output Volume</label>
                        <span className="text-sm font-black text-indigo-400 tabular-nums">{vSettings.outputVolume}%</span>
                      </div>
                      <input
                        type="range" min="0" max="200"
                        value={vSettings.outputVolume}
                        onChange={e => handleVoiceSlider("outputVolume", parseInt(e.target.value))}
                        className="w-full h-1.5 bg-rm-bg-elevated rounded-full appearance-none cursor-pointer accent-indigo-500"
                      />
                    </div>
                    {!vSettings.autoSensitivity && (
                      <div className="space-y-4">
                        <div className="flex justify-between items-end px-1">
                          <label className="text-[10px] font-bold uppercase tracking-wider text-rm-text-muted">Input Sensitivity</label>
                          <span className="text-sm font-black text-amber-400 tabular-nums">{vSettings.sensitivity}dB</span>
                        </div>
                        <input type="range" min="-100" max="0" value={vSettings.sensitivity}
                          onChange={e => handleVoiceSlider("sensitivity", parseInt(e.target.value))}
                          className="w-full h-1.5 bg-rm-bg-elevated rounded-full appearance-none cursor-pointer accent-amber-500"
                        />
                      </div>
                    )}
                  </section>

                  <Separator className="bg-rm-border" />

                  {/* Processing */}
                  <section className="space-y-5">
                    <div className="flex items-center gap-2">
                      <Zap size={14} className="text-amber-400" />
                      <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-rm-text-muted">Audio Processing</h3>
                    </div>
                    <div className="grid grid-cols-1 gap-3">
                      {[
                        { id: "noiseSuppression", label: "Noise Suppression", desc: "Removes background noise (Disables High Fidelity)", icon: <Mic size={16} /> },
                        { id: "echoCancellation", label: "Echo Cancellation", desc: "Prevents mic picking up speakers (Disables High Fidelity)", icon: <Speaker size={16} /> },
                        { id: "autoSensitivity", label: "Input Sensitivity", desc: "Auto-detect best input level (Disables High Fidelity)", icon: <Volume2 size={16} /> },
                        { id: "streamHighFidelity", label: "High Fidelity Audio", desc: "Disables all processing for stereo mic", icon: <Music size={16} /> },
                      ].map(opt => (
                        <div key={opt.id} className="group flex items-center justify-between p-3 rounded-xl bg-rm-bg-elevated/50 border border-rm-border hover:bg-rm-bg-hover transition-all">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-rm-bg-surface flex items-center justify-center text-rm-text-muted">{opt.icon}</div>
                            <div>
                              <h4 className="text-[13px] font-bold text-rm-text">{opt.label}</h4>
                              <p className="text-[11px] text-rm-text-muted">{opt.desc}</p>
                            </div>
                          </div>
                          <button
                            onClick={() => handleVoiceToggle(opt.id)}
                            className={cn(
                              "relative w-10 h-5 rounded-full transition-colors duration-200",
                              (vSettings as any)[opt.id] ? "bg-primary" : "bg-rm-bg-elevated border border-rm-border"
                            )}
                          >
                            <span className={cn(
                              "absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-200",
                              (vSettings as any)[opt.id] && "translate-x-5"
                            )} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </section>
                </div>
              </div>
            )}

            {activeTab === "appearance" && (
              <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                <h1 className="text-xl font-bold text-rm-text mb-1">Appearance</h1>
                <p className="text-sm text-rm-text-muted mb-8">Choose your preferred theme.</p>

                <div className="grid grid-cols-3 gap-4">
                  {[
                    { id: "dark", label: "Dark", preview: "bg-[#0f0f11]" },
                    { id: "light", label: "Light", preview: "bg-[#f2f3f5]" },
                    { id: "system", label: "System", preview: "bg-gradient-to-br from-[#0f0f11] to-[#f2f3f5]" },
                  ].map(t => (
                    <button
                      key={t.id}
                      onClick={() => setTheme(t.id)}
                      className={cn(
                        "rounded-xl border-2 p-1 transition-all",
                        theme === t.id ? "border-primary ring-2 ring-primary/20" : "border-rm-border hover:border-rm-text-muted/30"
                      )}
                    >
                      <div className={cn("h-16 rounded-lg mb-2", t.preview)} />
                      <span className="text-xs font-bold text-rm-text">{t.label}</span>
                    </button>
                  ))}
                </div>

                <div className="mt-8 bg-rm-bg-elevated/40 border border-rm-border rounded-xl p-5">
                  <div className="flex items-start gap-3">
                    <div className="p-2.5 rounded-lg bg-primary/10 text-primary border border-primary/20">
                      <Monitor size={20} />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-rm-text mb-1">Visual Comfort</h4>
                      <p className="text-xs text-rm-text-muted">Our dark mode uses true black and slate tones to reduce eye strain.</p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function TabBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center rounded-md px-2 py-1.5 text-[13px] font-medium transition-colors",
        active ? "bg-rm-bg-active text-rm-text" : "text-rm-text-muted hover:bg-rm-bg-hover hover:text-rm-text-secondary"
      )}
    >
      {label}
    </button>
  );
}
