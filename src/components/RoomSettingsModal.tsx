import { BaseModal } from "@/components/ui/BaseModal";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { createCameraBackgroundEffect } from "@/lib/camera-background-effects";
import {
  CAMERA_BACKGROUND_ACCEPT,
  deleteCameraBackground,
  getCameraBackgroundValidationError,
  listCameraBackgrounds,
  uploadCameraBackground,
} from "@/lib/camera-backgrounds";
import { CAMERA_QUALITY_PROFILES, buildCameraVideoConstraints } from "@/lib/camera-quality";
import { getAuthAssetUrl } from "@/lib/platform";
import { useMediaDevices } from "@/lib/useMediaDevices";
import { cn } from "@/lib/utils";
import type { CameraBackgroundSetting, CustomCameraBackground } from "@/stores/useVoiceSettingsStore";
import { useVoiceSettingsStore } from "@/stores/useVoiceSettingsStore";
import {
  Ban,
  Check,
  Lock,
  Mic,
  Monitor,
  Music,
  Sparkles,
  Speaker,
  Trash2,
  Upload,
  Volume2,
  X,
  Zap
} from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/shallow";
import { CustomSelect } from "./ui/CustomSelect";
import { VideoPlayer } from "./voice/VideoPlayer";

interface RoomSettingsModalProps {
  onClose: () => void;
  settingsUserId: string;
}

type Tab = "voice" | "camera" | "appearance";

export default function RoomSettingsModal({ onClose, settingsUserId }: RoomSettingsModalProps) {
  const { theme, setTheme } = useTheme();
  const [activeTab, setActiveTab] = useState<Tab>("voice");
  const [mounted, setMounted] = useState(false);

  const { audioInputs, audioOutputs, videoInputs } = useMediaDevices();
  const vSettings = useVoiceSettingsStore(useShallow(s => s.getSettings(settingsUserId)));
  const setDevice = useVoiceSettingsStore(s => s.setDevice);
  const updateUserSettings = useVoiceSettingsStore(s => s.updateUserSettings);

  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);
  const [webcamStream, setWebcamStream] = useState<MediaStream | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isUnauthenticated, setIsUnauthenticated] = useState(false);
  const [isLoadingBackgrounds, setIsLoadingBackgrounds] = useState(false);
  const [isUploadingBackground, setIsUploadingBackground] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Filter out browser's synthetic "default" device since we add our own Default option
  const filteredAudioInputs = audioInputs.filter(d => d.deviceId !== 'default');
  const filteredAudioOutputs = audioOutputs.filter(d => d.deviceId !== 'default');
  const defaultAudioInput = audioInputs.find((d) => d.deviceId === "default");
  const defaultAudioOutput = audioOutputs.find((d) => d.deviceId === "default");

  useEffect(() => {
    setMounted(true);
  }, []);

  // Load camera backgrounds on settings modal open / active camera tab
  useEffect(() => {
    if (activeTab !== "camera") return;

    let cancelled = false;
    setIsLoadingBackgrounds(true);
    void listCameraBackgrounds()
      .then((backgrounds) => {
        if (cancelled) return;
        updateUserSettings((current) => {
          const localOnlyBackgrounds = (current.customCameraBackgrounds ?? []).filter((background) => background.dataUrl && !background.url);
          const customCameraBackgrounds = [...backgrounds, ...localOnlyBackgrounds];
          const selectedBackgroundId = current.cameraBackground.type === "image" ? current.cameraBackground.id : null;
          const selectedBackgroundMissing = !!selectedBackgroundId
            && !customCameraBackgrounds.some((background) => background.id === selectedBackgroundId);

          return {
            ...current,
            cameraBackground: selectedBackgroundMissing ? { type: "none" } : current.cameraBackground,
            customCameraBackgrounds,
          };
        }, settingsUserId);
      })
      .catch((error) => {
        if (cancelled) return;
        const status = (error as any)?.status;
        if (status === 401) {
          setIsUnauthenticated(true);
        } else {
          setUploadError("Could not load saved backgrounds.");
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoadingBackgrounds(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeTab, settingsUserId, updateUserSettings]);

  // 1. Webcam Stream Lifecycle
  useEffect(() => {
    if (activeTab !== "camera") return;

    let active = true;
    let localStream: MediaStream | null = null;

    const startWebcam = async () => {
      try {
        const selectedDeviceId = vSettings.videoDeviceId || "default";
        const videoConstraints = buildCameraVideoConstraints({
          deviceId: selectedDeviceId,
          exactDevice: selectedDeviceId !== "default",
          qualityId: vSettings.cameraQuality,
        });
        const constraints = {
          video: videoConstraints,
          audio: false,
        };

        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (!active) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        localStream = stream;
        setWebcamStream(stream);
      } catch (err) {
        console.error("Failed to start settings camera preview:", err);
        if (active) {
          setWebcamStream(null);
        }
      }
    };

    startWebcam();

    return () => {
      active = false;
      setWebcamStream(null);
      if (localStream) {
        localStream.getTracks().forEach((t) => t.stop());
      }
    };
  }, [activeTab, vSettings.videoDeviceId, vSettings.cameraQuality]);

  // 2. Background Effect Lifecycle
  useEffect(() => {
    if (activeTab !== "camera" || !webcamStream) {
      setPreviewStream(null);
      return;
    }

    let active = true;
    let activeEffect: any = null;

    const applyEffect = async () => {
      const videoTrack = webcamStream.getVideoTracks()[0];
      if (videoTrack && vSettings.cameraBackground.type !== "none") {
        try {
          const effect = await createCameraBackgroundEffect(
            videoTrack,
            vSettings.cameraBackground,
            vSettings.customCameraBackgrounds || []
          );
          if (!active) {
            effect?.stop();
            return;
          }
          if (effect) {
            activeEffect = effect;
            setPreviewStream(effect.stream);
          } else {
            setPreviewStream(webcamStream);
          }
        } catch (err) {
          console.error("Failed to apply background effect:", err);
          if (active) {
            setPreviewStream(webcamStream);
          }
        }
      } else {
        setPreviewStream(webcamStream);
      }
    };

    applyEffect();

    return () => {
      active = false;
      if (activeEffect) {
        activeEffect.stop();
      }
    };
  }, [activeTab, webcamStream, vSettings.cameraBackground, vSettings.customCameraBackgrounds]);

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;

    const validationError = getCameraBackgroundValidationError(file);
    if (validationError) {
      setUploadError(validationError);
      return;
    }

    setIsUploadingBackground(true);
    try {
      const background = await uploadCameraBackground(file);
      updateUserSettings((current) => ({
        ...current,
        cameraBackground: { type: "image", id: background.id },
        customCameraBackgrounds: [
          background,
          ...(current.customCameraBackgrounds ?? []).filter((candidate) => candidate.id !== background.id),
        ],
      }), settingsUserId);
      setUploadError(null);
    } catch (error) {
      const status = (error as any)?.status;
      if (status === 401) setUploadError("Sign in to upload synced backgrounds.");
      else setUploadError(error instanceof Error ? error.message : "Could not upload that image.");
    } finally {
      setIsUploadingBackground(false);
    }
  };

  const removeBackground = async (background: CustomCameraBackground) => {
    if (background.url) {
      try {
        await deleteCameraBackground(background.id);
      } catch (error) {
        setUploadError(error instanceof Error ? error.message : "Could not remove that background.");
        return;
      }
    }

    updateUserSettings((current) => ({
      ...current,
      cameraBackground: current.cameraBackground.type === "image" && current.cameraBackground.id === background.id
        ? { type: "none" }
        : current.cameraBackground,
      customCameraBackgrounds: (current.customCameraBackgrounds ?? []).filter((candidate) => candidate.id !== background.id),
    }), settingsUserId);
    setUploadError(null);
  };

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

  return (
    <BaseModal onClose={onClose}>
      <div
        className="fixed inset-0 z-1000 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
        onClick={onClose}
        onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
        role="presentation"
      >
        <div
          className="relative flex flex-col md:flex-row w-full h-full md:h-full md:max-h-[640px] md:max-w-[860px] md:rounded-xl overflow-hidden shadow-2xl bg-rm-bg-primary md:border border-rm-border animate-in slide-in-from-bottom-full md:slide-in-from-bottom-0 md:fade-in duration-300 md:duration-200 pointer-events-auto"
          onClick={e => e.stopPropagation()}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") e.stopPropagation(); }}
          role="dialog"
          aria-modal="true"
          tabIndex={-1}
        >
          {/* Sidebar */}
          <div
            className="w-full md:w-[180px] flex flex-row md:flex-col shrink-0 bg-rm-server-bar pt-2 md:pt-10 pb-2 px-4 overflow-x-auto md:overflow-y-auto md:overflow-x-hidden custom-scrollbar border-b md:border-b-0 md:border-r border-rm-border/50 gap-2 md:gap-0"
            style={{ paddingTop: 'calc(8px + var(--safe-area-top, 0px))' }}
          >
            <div className="flex w-full md:w-auto items-center justify-between px-2 mb-0 md:mb-6 md:mt-0 gap-4">
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-rm-text-muted shrink-0">
                Room Settings
              </h3>
              <button
                onClick={onClose}
                className="md:hidden p-1 rounded-full bg-rm-bg-surface text-rm-text flex items-center justify-center hover:bg-rm-bg-hover active:scale-95 transition-all"
              >
                <X size={18} />
              </button>
            </div>

            {/* Audio & Video Subgroup */}
            <div className="flex flex-row md:flex-col gap-1 w-full mb-4 md:mb-6">
              <span className="hidden md:inline text-[9px] font-bold text-rm-text-muted/50 uppercase tracking-widest px-2 mb-1">
                Audio & Video
              </span>
              <TabBtn active={activeTab === "voice"} onClick={() => setActiveTab("voice")} label="Voice" />
              <TabBtn active={activeTab === "camera"} onClick={() => setActiveTab("camera")} label="Camera" />
            </div>

            {/* Theme Subgroup */}
            <div className="flex flex-row md:flex-col gap-1 w-full">
              <span className="hidden md:inline text-[9px] font-bold text-rm-text-muted/50 uppercase tracking-widest px-2 mb-1">
                Theme
              </span>
              <TabBtn active={activeTab === "appearance"} onClick={() => setActiveTab("appearance")} label="Appearance" />
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 flex flex-col relative overflow-hidden bg-rm-bg-primary">
            {/* Close */}
            <div className="absolute right-5 top-5 z-20 hidden md:flex flex-col items-center gap-1">
              <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full border border-rm-border text-rm-text-muted hover:bg-rm-bg-hover hover:text-rm-text transition-all">
                <X size={16} />
              </button>
              <span className="text-[11px] font-bold text-rm-text-muted">ESC</span>
            </div>

            <div
              className="flex-1 overflow-y-auto custom-scrollbar px-6 pb-10 pt-6 md:pt-10 max-w-[600px]"
              style={{ paddingBottom: 'calc(40px + var(--safe-area-bottom, 0px))' }}
            >
              {activeTab === "voice" && (
                <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                  <h1 className="text-xl font-bold text-rm-text mb-1">Voice Settings</h1>
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
                            onChange={e => {
                              const device = audioInputs.find((d) => d.deviceId === e.target.value);
                              setDevice("input", e.target.value, settingsUserId, {
                                label: device?.label,
                                groupId: device?.groupId,
                              });
                            }}
                            className="w-full rounded-lg border border-rm-border bg-rm-bg-elevated px-3 py-2 text-sm text-rm-text outline-none"
                          >
                            <option value="default">{defaultAudioInput?.label || "Default Microphone"}</option>
                            {filteredAudioInputs.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || `Mic ${d.deviceId.slice(0, 5)}`}</option>)}
                          </select>
                        </div>
                        <div className="space-y-2">
                          <Label className="text-[10px] font-bold uppercase tracking-wider text-rm-text-muted ml-1">Output Device</Label>
                          <select
                            value={vSettings.outputDeviceId}
                            onChange={e => {
                              const device = audioOutputs.find((d) => d.deviceId === e.target.value);
                              setDevice("output", e.target.value, settingsUserId, {
                                label: device?.label,
                                groupId: device?.groupId,
                              });
                            }}
                            className="w-full rounded-lg border border-rm-border bg-rm-bg-elevated px-3 py-2 text-sm text-rm-text outline-none"
                          >
                            <option value="default">{defaultAudioOutput?.label || "Default Speaker"}</option>
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
                          <label htmlFor="outputVolume" className="text-[10px] font-bold uppercase tracking-wider text-rm-text-muted">Output Volume</label>
                          <span className="text-sm font-black text-indigo-400 tabular-nums">{vSettings.outputVolume}%</span>
                        </div>
                        <input
                          id="outputVolume"
                          type="range" min="0" max="200"
                          value={vSettings.outputVolume}
                          onChange={e => handleVoiceSlider("outputVolume", parseInt(e.target.value))}
                          className="w-full h-1.5 bg-rm-bg-elevated rounded-full appearance-none cursor-pointer accent-indigo-500"
                        />
                      </div>
                      {!vSettings.autoSensitivity && (
                        <div className="space-y-4">
                          <div className="flex justify-between items-end px-1">
                            <label htmlFor="inputSensitivity" className="text-[10px] font-bold uppercase tracking-wider text-rm-text-muted">Input Sensitivity</label>
                            <span className="text-sm font-black text-amber-400 tabular-nums">{vSettings.sensitivity}dB</span>
                          </div>
                          <input id="inputSensitivity" type="range" min="-100" max="0" value={vSettings.sensitivity}
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

              {activeTab === "camera" && (
                <div className="animate-in fade-in slide-in-from-right-4 duration-300 space-y-8">
                  <div>
                    <h1 className="text-xl font-bold text-rm-text mb-1">Camera Settings</h1>
                    <p className="text-sm text-rm-text-muted">Configure your video input, capture quality, and background preferences.</p>
                  </div>

                  {/* Live Video Preview Box */}
                  <div className="relative aspect-video w-full max-w-[480px] overflow-hidden rounded-xl bg-black border border-rm-border flex items-center justify-center">
                    {previewStream && (
                      <VideoPlayer stream={previewStream} isLocal={true} className="h-full w-full object-contain bg-black" />
                    )}
                  </div>

                  {/* Camera dropdown selection */}
                  <div className="space-y-2 max-w-[480px]">
                    <Label className="text-[10px] font-bold uppercase tracking-wider text-rm-text-muted ml-1">Camera Device</Label>
                    <CustomSelect
                      value={vSettings.videoDeviceId || "default"}
                      onChange={(val) => {
                        const device = videoInputs.find((d) => d.deviceId === val);
                        setDevice("video", val, settingsUserId, {
                          label: device?.label,
                          groupId: device?.groupId,
                        });
                      }}
                      options={videoInputs.map((d) => ({
                        value: d.deviceId,
                        label: d.label || (d.deviceId === "default" ? "Default Camera" : "Camera"),
                      }))}
                      placeholder="Select camera device"
                    />
                  </div>

                  {/* Camera Quality */}
                  <div className="space-y-3">
                    <Label className="text-[10px] font-bold uppercase tracking-wider text-rm-text-muted ml-1">Capture Quality</Label>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 max-w-[480px]">
                      {CAMERA_QUALITY_PROFILES.map((profile) => {
                        const isSelected = vSettings.cameraQuality === profile.id;
                        return (
                          <button
                            key={profile.id}
                            onClick={() => updateUserSettings((current: any) => ({ ...current, cameraQuality: profile.id }), settingsUserId)}
                            className={cn(
                              "group rounded-xl border p-3 text-left outline-none transition-all",
                              isSelected
                                ? "border-primary bg-primary/5 ring-1 ring-primary"
                                : "border-rm-border bg-rm-bg-surface/40 hover:border-rm-text/20 hover:bg-rm-bg-surface/60"
                            )}
                          >
                            <div className="mb-1 flex items-center justify-between">
                              <div className="flex items-center gap-1.5">
                                <span className={cn("text-xs font-bold", isSelected ? "text-primary" : "text-rm-text")}>{profile.label}</span>
                                <span className="rounded-md bg-rm-bg-elevated/40 px-1 py-0.5 text-[8px] font-black text-rm-text-muted">{profile.fps} FPS</span>
                              </div>
                              {isSelected && <Check size={12} className="text-primary" />}
                            </div>
                            <p className="text-[9px] leading-tight text-rm-text-muted">{profile.width}x{profile.height}</p>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Video Background */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-3 px-1 max-w-[480px]">
                      <Label className="text-[10px] font-bold uppercase tracking-wider text-rm-text-muted">Video Background</Label>
                      {!isUnauthenticated && (
                        <>
                          <button
                            onClick={() => fileInputRef.current?.click()}
                            disabled={isUploadingBackground}
                            className="flex items-center gap-1.5 rounded-lg border border-rm-border bg-rm-bg-surface/40 px-2.5 py-1.5 text-[10px] font-black text-rm-text-muted transition-colors hover:text-rm-text"
                          >
                            <Upload size={12} /> {isUploadingBackground ? "Uploading" : "Upload Image"}
                          </button>
                          <input ref={fileInputRef} type="file" accept={CAMERA_BACKGROUND_ACCEPT} className="hidden" onChange={handleUpload} />
                        </>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 max-w-[480px]">
                      {[
                        {
                          id: "none",
                          label: "None",
                          value: { type: "none" } as CameraBackgroundSetting,
                        },
                        {
                          id: "blur",
                          label: "Blur",
                          value: { type: "blur", strength: "strong" } as CameraBackgroundSetting,
                        },
                      ].map((option) => {
                        const optionId = option.id;
                        const currentBgId = vSettings.cameraBackground.type === "blur"
                          ? "blur"
                          : vSettings.cameraBackground.type === "image"
                            ? `image-${vSettings.cameraBackground.id}`
                            : "none";
                        const isSelected = currentBgId === optionId;
                        return (
                          <button
                            key={option.id}
                            onClick={() => updateUserSettings((current: any) => ({ ...current, cameraBackground: option.value }), settingsUserId)}
                            className={cn(
                              "group relative flex flex-col rounded-xl border p-2.5 text-left outline-none transition-all",
                              isSelected
                                ? "border-primary bg-primary/5 ring-1 ring-primary"
                                : "border-rm-border bg-rm-bg-surface/40 hover:border-rm-text/20 hover:bg-rm-bg-surface/60"
                            )}
                          >
                            {option.id === "none" ? (
                              <div className="mb-2 flex h-16 w-full items-center justify-center rounded-lg bg-rm-bg-elevated/40 text-rm-text-muted/60 transition-all group-hover:scale-[1.02]">
                                <Ban size={20} />
                              </div>
                            ) : (
                              <div className="relative mb-2 flex h-16 w-full items-center justify-center overflow-hidden rounded-lg bg-rm-bg-elevated/40 transition-all group-hover:scale-[1.02]">
                                <div className="absolute inset-0 bg-gradient-to-tr from-blue-600/30 via-indigo-600/30 to-purple-600/30 filter blur-[8px]" />
                                <div className="absolute inset-0 bg-black/15" />
                                <Sparkles size={20} className="relative z-10 text-white/80" />
                              </div>
                            )}
                            <span className={cn("text-xs font-bold", isSelected ? "text-primary" : "text-rm-text")}>{option.label}</span>
                            {isSelected && <div className="absolute top-2 right-2 rounded-full bg-primary p-0.5 text-primary-foreground"><Check size={10} /></div>}
                          </button>
                        );
                      })}

                      {(vSettings.customCameraBackgrounds ?? []).map((background) => {
                        const currentBgId = vSettings.cameraBackground.type === "image" ? `image-${vSettings.cameraBackground.id}` : null;
                        const isSelected = currentBgId === `image-${background.id}`;
                        return (
                          <div
                            key={background.id}
                            className={cn(
                              "group relative overflow-hidden rounded-xl border bg-rm-bg-surface/40 outline-none transition-all",
                              isSelected ? "border-primary ring-1 ring-primary" : "border-rm-border hover:border-rm-text/20"
                            )}
                          >
                            <button onClick={() => updateUserSettings((current: any) => ({ ...current, cameraBackground: { type: "image", id: background.id } }), settingsUserId)} className="block w-full p-2 text-left">
                              <img src={background.url ? getAuthAssetUrl(background.url) : background.dataUrl} alt="" className="h-16 w-full rounded-lg object-cover" />
                              <div className="mt-2 flex items-center justify-between gap-2 px-1">
                                <span className={cn("truncate text-xs font-bold", isSelected ? "text-primary" : "text-rm-text")}>{background.name}</span>
                              </div>
                            </button>
                            {isSelected && <div className="absolute top-3 right-8 rounded-full bg-primary p-0.5 text-primary-foreground"><Check size={10} /></div>}
                            <button
                              onClick={() => void removeBackground(background)}
                              className="absolute right-2 top-2 rounded-md bg-black/60 p-1 text-white/80 opacity-0 transition-opacity hover:text-white group-hover:opacity-100"
                              aria-label={`Remove ${background.name}`}
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        );
                      })}

                      {isUnauthenticated && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <a
                              href="/sign-in"
                              target="_blank"
                              rel="noreferrer"
                              className="group relative flex flex-col rounded-xl border border-primary/20 bg-gradient-to-br from-indigo-500/10 via-purple-500/10 to-pink-500/10 p-2.5 text-left outline-none transition-all hover:border-primary/50 hover:from-indigo-500/15 hover:to-pink-500/15"
                            >
                              <div className="mb-2 flex h-16 w-full flex-col items-center justify-center rounded-lg bg-gradient-to-tr from-indigo-500/20 to-pink-500/20 text-primary transition-all group-hover:scale-[1.02]">
                                <Lock size={18} className="text-pink-400 group-hover:scale-110 transition-transform" />
                              </div>
                              <span className="text-xs font-bold text-primary-foreground/90 group-hover:text-primary">Upload Custom</span>
                            </a>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="bg-rm-bg-floating border border-rm-border text-rm-text-primary text-[12px] font-bold shadow-xl px-3 py-2 rounded-lg" sideOffset={8}>
                            Sign in to upload custom backgrounds
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                    {isLoadingBackgrounds && <p className="px-1 text-xs font-medium text-rm-text-muted">Loading saved backgrounds...</p>}
                    {uploadError && <p className="px-1 text-xs font-medium text-destructive">{uploadError}</p>}
                  </div>

                  {/* Always Preview Video Toggle */}
                  <div className="flex items-center justify-between p-3.5 rounded-xl bg-rm-bg-elevated/50 border border-rm-border hover:bg-rm-bg-hover transition-all max-w-[480px]">
                    <div>
                      <h4 className="text-[13px] font-bold text-rm-text">Always Preview Video</h4>
                      <p className="text-[11px] text-rm-text-muted">Show preview modal before starting video chat</p>
                    </div>
                    <button
                      onClick={() => {
                        updateUserSettings((current: any) => ({
                          ...current,
                          alwaysPreviewVideo: !current.alwaysPreviewVideo,
                        }), settingsUserId);
                      }}
                      className={cn(
                        "relative w-10 h-5 rounded-full transition-colors duration-200 outline-none",
                        vSettings.alwaysPreviewVideo ? "bg-primary" : "bg-rm-bg-elevated border border-rm-border"
                      )}
                    >
                      <span className={cn(
                        "absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-200",
                        vSettings.alwaysPreviewVideo && "translate-x-5"
                      )} />
                    </button>
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
      </div>
    </BaseModal>
  );
}

function TabBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "shrink-0 flex items-center md:justify-start justify-center rounded-full md:rounded-lg px-4 md:px-3 py-2 text-[13px] md:text-sm font-bold md:font-medium transition-colors w-full text-left",
        active ? "bg-primary text-primary-foreground md:bg-primary/10 md:text-primary" : "text-rm-text-secondary hover:bg-rm-bg-hover hover:text-rm-text bg-rm-bg-elevated/50 md:bg-transparent"
      )}
    >
      {label}
    </button>
  );
}
