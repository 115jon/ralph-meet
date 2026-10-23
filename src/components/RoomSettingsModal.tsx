import { Dialog, DialogPortal, DialogSurface } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { createCameraBackgroundEffect } from "@/lib/camera-background-effects";
import {
  CAMERA_BACKGROUND_ACCEPT,
  deleteCameraBackground,
  getCameraBackgroundValidationError,
  listCameraBackgrounds,
  uploadCameraBackground,
} from "@/lib/camera-backgrounds";
import {
  CAMERA_QUALITY_PROFILES,
  buildCameraVideoConstraints,
} from "@/lib/camera-quality";
import { getAuthAssetUrl } from "@/lib/platform";
import { useMediaDevices } from "@/lib/useMediaDevices";
import { cn } from "@/lib/utils";
import type {
  CameraBackgroundSetting,
  CustomCameraBackground,
} from "@/stores/useVoiceSettingsStore";
import { useVoiceSettingsStore } from "@/stores/useVoiceSettingsStore";
import { Icon } from "@/components/ui/icon";
import { useTheme } from "next-themes";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useShallow } from "zustand/shallow";
import { NoiseReductionPanel } from "./chat/NoiseReductionPanel";
import InlineEmojiText from "./chat/InlineEmojiText";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { shouldIgnoreSelectDismiss } from "./ui/select-dismiss";
import { VideoPlayer } from "./voice/VideoPlayer";
import { AudioCompatibilityHint } from "./chat/AudioCompatibilityHint";

interface RoomSettingsModalProps {
  open: boolean;
  onClose: () => void;
  settingsUserId: string;
}

type Tab = "voice" | "camera" | "appearance";

export default function RoomSettingsModal({
  open,
  onClose,
  settingsUserId,
}: RoomSettingsModalProps) {
  const { theme, setTheme } = useTheme();
  const [activeTab, setActiveTab] = useState<Tab>("voice");
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  const { audioInputs, audioOutputs, videoInputs } = useMediaDevices();
  const vSettings = useVoiceSettingsStore(
    useShallow((s) => s.getSettings(settingsUserId)),
  );
  const setDevice = useVoiceSettingsStore((s) => s.setDevice);
  const updateUserSettings = useVoiceSettingsStore((s) => s.updateUserSettings);
  const updateVoiceSettings = useVoiceSettingsStore(
    (s) => s.updateVoiceSettings,
  );

  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);
  const webcamStreamRef = useRef<MediaStream | null>(null);
  const previewEffectRef = useRef<any>(null);
  const previewRequestIdRef = useRef(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isUnauthenticated, setIsUnauthenticated] = useState(false);
  const [isLoadingBackgrounds, setIsLoadingBackgrounds] = useState(false);
  const [isUploadingBackground, setIsUploadingBackground] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Filter out browser's synthetic "default" device since we add our own Default option
  const filteredAudioInputs = audioInputs.filter(
    (d) => d.deviceId !== "default",
  );
  const filteredAudioOutputs = audioOutputs.filter(
    (d) => d.deviceId !== "default",
  );
  const defaultAudioInput = audioInputs.find((d) => d.deviceId === "default");
  const defaultAudioOutput = audioOutputs.find((d) => d.deviceId === "default");

  const latestCameraBackgroundRef = useRef(vSettings.cameraBackground);
  const latestCustomCameraBackgroundsRef = useRef(
    vSettings.customCameraBackgrounds ?? [],
  );
  latestCameraBackgroundRef.current = vSettings.cameraBackground;
  latestCustomCameraBackgroundsRef.current =
    vSettings.customCameraBackgrounds ?? [];

  const applyPreviewStream = useCallback(
    async (
      stream: MediaStream | null,
      cameraBackground: CameraBackgroundSetting,
      customCameraBackgrounds: CustomCameraBackground[],
    ) => {
      const requestId = ++previewRequestIdRef.current;
      previewEffectRef.current?.stop?.();
      previewEffectRef.current = null;

      if (!stream) {
        setPreviewStream(null);
        return;
      }

      const videoTrack = stream.getVideoTracks()[0];
      if (!videoTrack || cameraBackground.type === "none") {
        setPreviewStream(stream);
        return;
      }

      try {
        const effect = await createCameraBackgroundEffect(
          videoTrack,
          cameraBackground,
          customCameraBackgrounds,
        );
        if (previewRequestIdRef.current !== requestId) {
          effect?.stop?.();
          return;
        }
        if (effect) {
          previewEffectRef.current = effect;
          setPreviewStream(effect.stream);
        } else {
          setPreviewStream(stream);
        }
      } catch (err) {
        if (previewRequestIdRef.current === requestId) {
          console.error("Failed to apply background effect:", err);
          setPreviewStream(stream);
        }
      }
    },
    [],
  );

  // Load camera backgrounds on settings modal open / active camera tab
  useEffect(() => {
    if (activeTab !== "camera") return;

    let cancelled = false;
    setIsLoadingBackgrounds(true);
    void listCameraBackgrounds()
      .then((backgrounds) => {
        if (cancelled) return;
        updateUserSettings((current) => {
          const localOnlyBackgrounds = (
            current.customCameraBackgrounds ?? []
          ).filter((background) => background.dataUrl && !background.url);
          const customCameraBackgrounds = [
            ...backgrounds,
            ...localOnlyBackgrounds,
          ];
          const selectedBackgroundId =
            current.cameraBackground.type === "image"
              ? current.cameraBackground.id
              : null;
          const selectedBackgroundMissing =
            !!selectedBackgroundId &&
            !customCameraBackgrounds.some(
              (background) => background.id === selectedBackgroundId,
            );

          return {
            ...current,
            cameraBackground: selectedBackgroundMissing
              ? { type: "none" }
              : current.cameraBackground,
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

        webcamStreamRef.current = stream;
        await applyPreviewStream(
          stream,
          latestCameraBackgroundRef.current,
          latestCustomCameraBackgroundsRef.current,
        );
      } catch (err) {
        console.error("Failed to start settings camera preview:", err);
        if (active) {
          webcamStreamRef.current = null;
          setPreviewStream(null);
        }
      }
    };

    void startWebcam();

    return () => {
      active = false;
      previewRequestIdRef.current += 1;
      previewEffectRef.current?.stop?.();
      previewEffectRef.current = null;
      if (webcamStreamRef.current) {
        webcamStreamRef.current.getTracks().forEach((t) => t.stop());
        webcamStreamRef.current = null;
      }
      setPreviewStream(null);
    };
  }, [
    activeTab,
    applyPreviewStream,
    vSettings.videoDeviceId,
    vSettings.cameraQuality,
  ]);

  // 2. Background Effect Lifecycle
  useEffect(() => {
    if (activeTab !== "camera") {
      return;
    }
    void applyPreviewStream(
      webcamStreamRef.current,
      vSettings.cameraBackground,
      vSettings.customCameraBackgrounds ?? [],
    );
  }, [
    activeTab,
    applyPreviewStream,
    vSettings.cameraBackground,
    vSettings.customCameraBackgrounds,
  ]);

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
      updateUserSettings(
        (current) => ({
          ...current,
          cameraBackground: { type: "image", id: background.id },
          customCameraBackgrounds: [
            background,
            ...(current.customCameraBackgrounds ?? []).filter(
              (candidate) => candidate.id !== background.id,
            ),
          ],
        }),
        settingsUserId,
      );
      setUploadError(null);
    } catch (error) {
      const status = (error as any)?.status;
      if (status === 401)
        setUploadError("Sign in to upload synced backgrounds.");
      else
        setUploadError(
          error instanceof Error
            ? error.message
            : "Could not upload that image.",
        );
    } finally {
      setIsUploadingBackground(false);
    }
  };

  const removeBackground = async (background: CustomCameraBackground) => {
    if (background.url) {
      try {
        await deleteCameraBackground(background.id);
      } catch (error) {
        setUploadError(
          error instanceof Error
            ? error.message
            : "Could not remove that background.",
        );
        return;
      }
    }

    updateUserSettings(
      (current) => ({
        ...current,
        cameraBackground:
          current.cameraBackground.type === "image" &&
          current.cameraBackground.id === background.id
            ? { type: "none" }
            : current.cameraBackground,
        customCameraBackgrounds: (current.customCameraBackgrounds ?? []).filter(
          (candidate) => candidate.id !== background.id,
        ),
      }),
      settingsUserId,
    );
    setUploadError(null);
  };

  const handleVoiceToggle = (key: string) => {
    updateVoiceSettings((s: any) => {
      const newVal = !s[key];
      const updates: any = { [key]: newVal };

      // High fidelity disables browser capture processing, but not local
      // RNNoise or sensitivity gating.
      if (key === "streamHighFidelity" && newVal) {
        updates.echoCancellation = false;
        updates.noiseSuppression = false;
      }

      if (key === "noiseReductionEnabled" && newVal) {
        updates.noiseSuppression = false;
      }

      if (key === "noiseSuppression" && newVal) {
        updates.noiseReductionEnabled = false;
        updates.streamHighFidelity = false;
      }

      // Browser capture processing requires High Fidelity to be OFF.
      if (
        (key === "echoCancellation" || key === "noiseSuppression") &&
        newVal
      ) {
        updates.streamHighFidelity = false;
      }

      return { ...s, ...updates };
    }, settingsUserId);
  };

  const handleVoiceSlider = (key: string, val: number) => {
    updateVoiceSettings((s: any) => ({ ...s, [key]: val }), settingsUserId);
  };

  if (!mounted) return null;

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogPortal>
        <DialogSurface
          showCloseButton={false}
          className="fixed inset-0 z-50 m-0 flex min-h-0 h-full w-full items-center justify-center bg-black/60 p-4 outline-none animate-in fade-in duration-200 data-[state=closed]:animate-out data-[state=closed]:fade-out"
          aria-labelledby="room-settings-title"
          onPointerDown={(event) => {
            if (event.target !== event.currentTarget) return;
            if (shouldIgnoreSelectDismiss(event.target)) return;
            onClose();
          }}
        >
          <div className="relative m-0 flex min-h-0 h-full w-full flex-col overflow-hidden bg-rm-bg-primary p-0 shadow-2xl pointer-events-auto outline-none animate-in slide-in-from-bottom-full md:h-full md:max-h-[640px] md:max-w-[860px] md:flex-row md:rounded-xl md:border border-rm-border md:slide-in-from-bottom-0 md:fade-in duration-300 md:duration-200">
            {/* Sidebar */}
            <div
              className="w-full min-h-0 md:w-[180px] flex flex-row md:flex-col shrink-0 bg-rm-server-bar pt-2 md:pt-10 pb-2 px-4 overflow-x-auto md:overflow-y-auto md:overflow-x-hidden custom-scrollbar border-b md:border-b-0 md:border-r border-rm-border/50 gap-2 md:gap-0"
              style={{ paddingTop: "calc(8px + var(--safe-area-top, 0px))" }}
            >
              <div className="flex w-full md:w-auto items-center justify-between px-2 mb-0 md:mb-6 md:mt-0 gap-4">
                <h3
                  id="room-settings-title"
                  className="text-ui-2xs font-semibold uppercase tracking-[0.08em] text-rm-text-muted shrink-0"
                >
                  Room Settings
                </h3>
                <button
                  type="button"
                  onClick={onClose}
                  className="md:hidden p-1 rounded-full bg-rm-bg-surface text-rm-text flex items-center justify-center pointer-fine:hover:bg-rm-bg-hover active:scale-[0.96] transition-ui"
                  aria-label="Close room settings"
                >
                  <Icon name="close" size="md" />
                </button>
              </div>

              {/* Audio & Video Subgroup */}
              <div className="flex flex-row md:flex-col gap-1 w-full mb-4 md:mb-6">
                <span className="text-ui-2xs font-semibold uppercase tracking-[0.08em] hidden md:inline text-rm-text-muted/50 px-2 mb-1">
                  Audio & Video
                </span>
                <TabBtn
                  active={activeTab === "voice"}
                  onClick={() => setActiveTab("voice")}
                  label="Voice"
                />
                <TabBtn
                  active={activeTab === "camera"}
                  onClick={() => setActiveTab("camera")}
                  label="Camera"
                />
              </div>

              {/* Theme Subgroup */}
              <div className="flex flex-row md:flex-col gap-1 w-full">
                <span className="text-ui-2xs font-semibold uppercase tracking-[0.08em] hidden md:inline text-rm-text-muted/50 px-2 mb-1">
                  Theme
                </span>
                <TabBtn
                  active={activeTab === "appearance"}
                  onClick={() => setActiveTab("appearance")}
                  label="Appearance"
                />
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 min-h-0 flex flex-col relative overflow-hidden bg-rm-bg-primary">
              {/* Close */}
              <div className="absolute right-5 top-5 z-20 hidden md:flex flex-col items-center gap-1">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-rm-border text-rm-text-muted pointer-fine:hover:bg-rm-bg-hover pointer-fine:hover:text-rm-text transition-ui"
                  aria-label="Close room settings"
                >
                  <Icon name="close" size="sm" />
                </button>
                <span className="text-ui-2xs font-bold text-rm-text-muted">
                  ESC
                </span>
              </div>

              <div
                className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-6 pb-10 pt-6 md:pt-10 max-w-[600px]"
                style={{
                  paddingBottom: "calc(40px + var(--safe-area-bottom, 0px))",
                }}
              >
                {activeTab === "voice" && (
                  <div className="animate-in fade-in duration-150">
                    <h1 className="text-ui-xl font-semibold text-rm-text mb-1">
                      Voice Settings
                    </h1>
                    <p className="text-ui-sm text-rm-text-muted mb-8">
                      Configure your media devices and audio processing.
                    </p>

                    <div className="space-y-10">
                      {/* Hardware */}
                      <section className="space-y-5">
                        <div className="flex items-center gap-2">
                          <Icon
                            name="voiceChannel"
                            size="sm"
                            className="text-rm-accent"
                          />
                          <h3 className="text-ui-2xs font-semibold uppercase tracking-[0.08em] text-rm-text-muted">
                            Hardware
                          </h3>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                          <div className="space-y-2">
                            <Label
                              htmlFor="room-settings-input-device"
                              className="text-ui-2xs font-semibold uppercase tracking-[0.08em] text-rm-text-muted ml-1"
                            >
                              Input Device
                            </Label>
                            <Select
                              value={vSettings.inputDeviceId}
                              onValueChange={(value) => {
                                const device = audioInputs.find(
                                  (d) => d.deviceId === value,
                                );
                                setDevice("input", value, settingsUserId, {
                                  label: device?.label,
                                  groupId: device?.groupId,
                                });
                              }}
                            >
                              <SelectTrigger
                                id="room-settings-input-device"
                                aria-label="Select input device"
                                className="w-full rounded-lg border-rm-border bg-rm-bg-elevated px-3 py-2 text-ui-sm text-rm-text outline-none"
                              >
                                <SelectValue placeholder="Select input device" />
                              </SelectTrigger>
                              <SelectContent position="popper" align="start">
                                <SelectItem
                                  value="default"
                                  textValue={
                                    defaultAudioInput?.label ||
                                    "Default Microphone"
                                  }
                                >
                                  <InlineEmojiText
                                    text={
                                      defaultAudioInput?.label ||
                                      "Default Microphone"
                                    }
                                  />
                                </SelectItem>
                                {filteredAudioInputs.map((device) => {
                                  const label =
                                    device.label ||
                                    `Mic ${device.deviceId.slice(0, 5)}`;
                                  return (
                                    <SelectItem
                                      key={device.deviceId}
                                      value={device.deviceId}
                                      textValue={label}
                                    >
                                      <InlineEmojiText text={label} />
                                    </SelectItem>
                                  );
                                })}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2">
                            <Label
                              htmlFor="room-settings-output-device"
                              className="text-ui-2xs font-semibold uppercase tracking-[0.08em] text-rm-text-muted ml-1"
                            >
                              Output Device
                            </Label>
                            <Select
                              value={vSettings.outputDeviceId}
                              onValueChange={(value) => {
                                const device = audioOutputs.find(
                                  (d) => d.deviceId === value,
                                );
                                setDevice("output", value, settingsUserId, {
                                  label: device?.label,
                                  groupId: device?.groupId,
                                });
                              }}
                            >
                              <SelectTrigger
                                id="room-settings-output-device"
                                aria-label="Select output device"
                                className="w-full rounded-lg border-rm-border bg-rm-bg-elevated px-3 py-2 text-ui-sm text-rm-text outline-none"
                              >
                                <SelectValue placeholder="Select output device" />
                              </SelectTrigger>
                              <SelectContent position="popper" align="start">
                                <SelectItem
                                  value="default"
                                  textValue={
                                    defaultAudioOutput?.label ||
                                    "Default Speaker"
                                  }
                                >
                                  <InlineEmojiText
                                    text={
                                      defaultAudioOutput?.label ||
                                      "Default Speaker"
                                    }
                                  />
                                </SelectItem>
                                {filteredAudioOutputs.map((device) => {
                                  const label =
                                    device.label ||
                                    `Speaker ${device.deviceId.slice(0, 5)}`;
                                  return (
                                    <SelectItem
                                      key={device.deviceId}
                                      value={device.deviceId}
                                      textValue={label}
                                    >
                                      <InlineEmojiText text={label} />
                                    </SelectItem>
                                  );
                                })}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      </section>

                      <Separator className="bg-rm-border" />

                      {/* Volume */}
                      <section className="space-y-5">
                        <div className="flex items-center gap-2">
                          <Icon
                            name="voiceChannel"
                            size="sm"
                            className="text-emerald-400"
                          />
                          <h3 className="text-ui-2xs font-semibold uppercase tracking-[0.08em] text-rm-text-muted">
                            Volume
                          </h3>
                        </div>
                        <div className="space-y-4">
                          <div className="flex justify-between items-end px-1">
                            <label
                              htmlFor="outputVolume"
                              className="text-ui-2xs font-semibold uppercase tracking-[0.08em] text-rm-text-muted"
                            >
                              Output Volume
                            </label>
                            <span className="text-ui-sm font-semibold text-rm-accent tabular-nums">
                              {vSettings.outputVolume}%
                            </span>
                          </div>
                          <input
                            id="outputVolume"
                            type="range"
                            min="0"
                            max="200"
                            value={vSettings.outputVolume}
                            onChange={(e) =>
                              handleVoiceSlider(
                                "outputVolume",
                                parseInt(e.target.value),
                              )
                            }
                            className="w-full h-1.5 bg-rm-bg-elevated rounded-full appearance-none cursor-pointer accent-rm-accent"
                          />
                        </div>
                        {!vSettings.autoSensitivity && (
                          <div className="space-y-4">
                            <div className="flex justify-between items-end px-1">
                              <label
                                htmlFor="inputSensitivity"
                                className="text-ui-2xs font-semibold uppercase tracking-[0.08em] text-rm-text-muted"
                              >
                                Input Sensitivity
                              </label>
                              <span className="text-ui-sm font-semibold text-amber-600 dark:text-amber-400 tabular-nums">
                                {vSettings.sensitivity}dB
                              </span>
                            </div>
                            <input
                              id="inputSensitivity"
                              type="range"
                              min="-100"
                              max="0"
                              value={vSettings.sensitivity}
                              onChange={(e) =>
                                handleVoiceSlider(
                                  "sensitivity",
                                  parseInt(e.target.value),
                                )
                              }
                              className="w-full h-1.5 bg-rm-bg-elevated rounded-full appearance-none cursor-pointer accent-amber-500"
                            />
                          </div>
                        )}
                      </section>

                      <Separator className="bg-rm-border" />

                      <section className="space-y-5">
                        <div className="flex items-center gap-2">
                          <Icon
                            name="sparkle"
                            size="sm"
                            className="text-sky-300"
                          />
                          <h3 className="text-ui-2xs font-semibold uppercase tracking-[0.08em] text-rm-text-muted">
                            Noise Suppression
                          </h3>
                        </div>
                        <NoiseReductionPanel settingsUserId={settingsUserId} />
                      </section>

                      <Separator className="bg-rm-border" />

                      {/* Processing */}
                      <section className="space-y-5">
                        <div className="flex items-center gap-2">
                          <Icon
                            name="zap"
                            size="sm"
                            className="text-amber-600 dark:text-amber-400"
                          />
                          <h3 className="text-ui-2xs font-semibold uppercase tracking-[0.08em] text-rm-text-muted">
                            Audio Processing
                          </h3>
                        </div>
                        <div className="grid grid-cols-1 gap-3">
                          {[
                            {
                              id: "noiseSuppression",
                              label: "Browser Noise Suppression",
                              desc: (
                                <>
                                  Uses the browser's built-in noise suppression.
                                  <AudioCompatibilityHint>
                                    Browser noise suppression is unavailable
                                    with RNNoise or high fidelity audio.
                                  </AudioCompatibilityHint>
                                </>
                              ),
                              icon: <Icon name="mic" size="sm" />,
                            },
                            {
                              id: "echoCancellation",
                              label: "Echo Cancellation",
                              desc: (
                                <>
                                  Prevents mic pickup from speakers.
                                  <AudioCompatibilityHint>
                                    Echo cancellation disables high fidelity
                                    capture, but remains compatible with
                                    RNNoise.
                                  </AudioCompatibilityHint>
                                </>
                              ),
                              icon: <Icon name="speaker" size="sm" />,
                            },
                            {
                              id: "autoSensitivity",
                              label: "Input Sensitivity",
                              desc: "Auto-detect the best input level.",
                              icon: <Icon name="voiceChannel" size="sm" />,
                            },
                            {
                              id: "streamHighFidelity",
                              label: "High Fidelity Audio",
                              desc: (
                                <>
                                  Disables browser processing for stereo mic.
                                  <AudioCompatibilityHint>
                                    RNNoise and input sensitivity remain
                                    available in high fidelity mode.
                                  </AudioCompatibilityHint>
                                </>
                              ),
                              icon: <Icon name="music" size="sm" />,
                            },
                          ].map((opt) => (
                            <div
                              key={opt.id}
                              className="group flex items-center justify-between p-3 rounded-xl bg-rm-bg-elevated/50 border border-rm-border pointer-fine:hover:bg-rm-bg-hover transition-ui"
                            >
                              <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-lg bg-rm-bg-surface flex items-center justify-center text-rm-text-muted">
                                  {opt.icon}
                                </div>
                                <div>
                                  <h4 className="text-ui-sm font-semibold text-rm-text">
                                    {opt.label}
                                  </h4>
                                  <p className="text-ui-2xs text-rm-text-muted">
                                    {opt.desc}
                                  </p>
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => handleVoiceToggle(opt.id)}
                                aria-label={opt.label}
                                aria-pressed={Boolean(
                                  (vSettings as any)[opt.id],
                                )}
                                className={cn(
                                  "relative w-10 h-5 rounded-full transition-colors duration-200",
                                  (vSettings as any)[opt.id]
                                    ? "bg-primary"
                                    : "bg-rm-bg-elevated border border-rm-border",
                                )}
                              >
                                <span
                                  className={cn(
                                    "absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-200",
                                    (vSettings as any)[opt.id] &&
                                      "translate-x-5",
                                  )}
                                />
                              </button>
                            </div>
                          ))}
                        </div>
                      </section>
                    </div>
                  </div>
                )}

                {activeTab === "camera" && (
                  <div className="animate-in fade-in duration-150 space-y-8">
                    <div>
                      <h1 className="text-ui-xl font-semibold text-rm-text mb-1">
                        Camera Settings
                      </h1>
                      <p className="text-ui-sm text-rm-text-muted">
                        Configure your video input, capture quality, and
                        background preferences.
                      </p>
                    </div>

                    {/* Live Video Preview Box */}
                    <div className="relative aspect-video w-full max-w-[480px] overflow-hidden rounded-xl bg-black border border-rm-border flex items-center justify-center">
                      {previewStream && (
                        <VideoPlayer
                          stream={previewStream}
                          isLocal={true}
                          className="h-full w-full object-contain bg-black"
                        />
                      )}
                    </div>

                    {/* Camera dropdown selection */}
                    <div className="space-y-2 max-w-[480px]">
                      <div className="flex flex-col gap-2">
                        <p className="text-ui-2xs font-semibold uppercase tracking-[0.08em] ml-1 text-rm-text-muted">
                          Camera Device
                        </p>
                        <Select
                          value={vSettings.videoDeviceId || "default"}
                          onValueChange={(val) => {
                            const device = videoInputs.find(
                              (d) => d.deviceId === val,
                            );
                            setDevice("video", val, settingsUserId, {
                              label: device?.label,
                              groupId: device?.groupId,
                            });
                          }}
                        >
                          <SelectTrigger
                            aria-label="Select camera device"
                            className="w-full max-w-[480px] rounded-xl border-rm-border bg-rm-bg-elevated/50 px-4 py-3 text-rm-text pointer-fine:hover:bg-rm-bg-elevated"
                          >
                            <SelectValue placeholder="Select camera device" />
                          </SelectTrigger>
                          <SelectContent
                            position="popper"
                            align="start"
                            className="rounded-xl border-rm-border bg-rm-bg-floating p-1.5 text-rm-text shadow-2xl"
                          >
                            {videoInputs.map((device) => {
                              const label =
                                device.label ||
                                (device.deviceId === "default"
                                  ? "Default Camera"
                                  : "Camera");
                              return (
                                <SelectItem
                                  key={device.deviceId}
                                  value={device.deviceId}
                                  textValue={label}
                                  className="text-rm-text-secondary pointer-fine:hover:bg-rm-bg-elevated pointer-fine:hover:text-rm-text focus:bg-rm-bg-elevated focus:text-rm-text"
                                >
                                  <InlineEmojiText text={label} />
                                </SelectItem>
                              );
                            })}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    {/* Camera Quality */}
                    <div className="space-y-3">
                      <p className="text-ui-2xs font-semibold uppercase tracking-[0.08em] ml-1 text-rm-text-muted">
                        Capture Quality
                      </p>
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 max-w-[480px]">
                        {CAMERA_QUALITY_PROFILES.map((profile) => {
                          const isSelected =
                            vSettings.cameraQuality === profile.id;
                          return (
                            <button
                              type="button"
                              key={profile.id}
                              onClick={() =>
                                updateUserSettings(
                                  (current: any) => ({
                                    ...current,
                                    cameraQuality: profile.id,
                                  }),
                                  settingsUserId,
                                )
                              }
                              className={cn(
                                "group rounded-xl border p-3 text-left outline-none transition-ui",
                                isSelected
                                  ? "border-primary bg-primary/5 ring-1 ring-primary"
                                  : "border-rm-border bg-rm-bg-surface/40 pointer-fine:hover:border-rm-text/20 pointer-fine:hover:bg-rm-bg-surface/60",
                              )}
                            >
                              <div className="mb-1 flex items-center justify-between">
                                <div className="flex items-center gap-1.5">
                                  <span
                                    className={cn(
                                      "text-ui-xs font-semibold",
                                      isSelected
                                        ? "text-primary"
                                        : "text-rm-text",
                                    )}
                                  >
                                    {profile.label}
                                  </span>
                                  <span className="rounded-md bg-rm-bg-elevated/40 px-1 py-0.5 text-ui-2xs font-bold text-rm-text-muted">
                                    {profile.fps} FPS
                                  </span>
                                </div>
                                {isSelected && (
                                  <Icon
                                    name="check"
                                    size="xs"
                                    className="text-primary"
                                  />
                                )}
                              </div>
                              <p className="text-ui-2xs leading-tight text-rm-text-muted">
                                {profile.width}x{profile.height}
                              </p>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Video Background */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-3 px-1 max-w-[480px]">
                        <p className="text-ui-2xs font-semibold uppercase tracking-[0.08em] text-rm-text-muted">
                          Video Background
                        </p>
                        {!isUnauthenticated && (
                          <>
                            <button
                              type="button"
                              onClick={() => fileInputRef.current?.click()}
                              disabled={isUploadingBackground}
                              className="flex items-center gap-1.5 rounded-lg border border-rm-border bg-rm-bg-surface/40 px-2.5 py-1.5 text-ui-2xs font-bold text-rm-text-muted transition-colors pointer-fine:hover:text-rm-text"
                            >
                              <Icon name="upload" size="xs" />{" "}
                              {isUploadingBackground
                                ? "Uploading"
                                : "Upload Image"}
                            </button>
                            <input
                              ref={fileInputRef}
                              type="file"
                              accept={CAMERA_BACKGROUND_ACCEPT}
                              className="hidden"
                              aria-label="Upload video background image"
                              onChange={handleUpload}
                            />
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
                            value: {
                              type: "blur",
                              strength: "strong",
                            } as CameraBackgroundSetting,
                          },
                        ].map((option) => {
                          const optionId = option.id;
                          const currentBgId =
                            vSettings.cameraBackground.type === "blur"
                              ? "blur"
                              : vSettings.cameraBackground.type === "image"
                                ? `image-${vSettings.cameraBackground.id}`
                                : "none";
                          const isSelected = currentBgId === optionId;
                          return (
                            <button
                              type="button"
                              key={option.id}
                              onClick={() =>
                                updateUserSettings(
                                  (current: any) => ({
                                    ...current,
                                    cameraBackground: option.value,
                                  }),
                                  settingsUserId,
                                )
                              }
                              className={cn(
                                "group relative flex flex-col rounded-xl border p-2.5 text-left outline-none transition-ui",
                                isSelected
                                  ? "border-primary bg-primary/5 ring-1 ring-primary"
                                  : "border-rm-border bg-rm-bg-surface/40 pointer-fine:hover:border-rm-text/20 pointer-fine:hover:bg-rm-bg-surface/60",
                              )}
                            >
                              {option.id === "none" ? (
                                <div className="mb-2 flex h-16 w-full items-center justify-center rounded-lg bg-rm-bg-elevated/40 text-rm-text-muted/60 transition-ui">
                                  <Icon name="ban" size="lg" />
                                </div>
                              ) : (
                                <div className="relative mb-2 flex h-16 w-full items-center justify-center overflow-hidden rounded-lg bg-rm-bg-elevated/40 transition-ui">
                                  <div
                                    data-rm-preserve-blur="true"
                                    className="absolute inset-0 bg-gradient-to-tr from-primary/30 via-rm-accent/25 to-rm-accent/40 filter blur-[8px]"
                                  />
                                  <div className="absolute inset-0 bg-black/15" />
                                  <Icon
                                    name="sparkle"
                                    size="lg"
                                    className="relative z-10 text-white/80"
                                  />
                                </div>
                              )}
                              <span
                                className={cn(
                                  "text-ui-xs font-semibold",
                                  isSelected ? "text-primary" : "text-rm-text",
                                )}
                              >
                                {option.label}
                              </span>
                              {isSelected && (
                                <div className="absolute top-2 right-2 rounded-full bg-primary p-0.5 text-primary-foreground">
                                  <Icon name="check" size="xs" />
                                </div>
                              )}
                            </button>
                          );
                        })}

                        {(vSettings.customCameraBackgrounds ?? []).map(
                          (background) => {
                            const currentBgId =
                              vSettings.cameraBackground.type === "image"
                                ? `image-${vSettings.cameraBackground.id}`
                                : null;
                            const isSelected =
                              currentBgId === `image-${background.id}`;
                            return (
                              <div
                                key={background.id}
                                className={cn(
                                  "group relative overflow-hidden rounded-xl border bg-rm-bg-surface/40 outline-none transition-ui",
                                  isSelected
                                    ? "border-primary ring-1 ring-primary"
                                    : "border-rm-border pointer-fine:hover:border-rm-text/20",
                                )}
                              >
                                <button
                                  type="button"
                                  onClick={() =>
                                    updateUserSettings(
                                      (current: any) => ({
                                        ...current,
                                        cameraBackground: {
                                          type: "image",
                                          id: background.id,
                                        },
                                      }),
                                      settingsUserId,
                                    )
                                  }
                                  className="block w-full p-2 text-left"
                                >
                                  <img
                                    src={
                                      background.url
                                        ? getAuthAssetUrl(background.url)
                                        : background.dataUrl
                                    }
                                    alt=""
                                    className="h-16 w-full rounded-lg object-cover"
                                  />
                                  <div className="mt-2 flex items-center justify-between gap-2 px-1">
                                    <span
                                      className={cn(
                                        "truncate text-ui-xs font-semibold",
                                        isSelected
                                          ? "text-primary"
                                          : "text-rm-text",
                                      )}
                                    >
                                      {background.name}
                                    </span>
                                  </div>
                                </button>
                                {isSelected && (
                                  <div className="absolute top-3 right-8 rounded-full bg-primary p-0.5 text-primary-foreground">
                                    <Icon name="check" size="xs" />
                                  </div>
                                )}
                                <button
                                  type="button"
                                  onClick={() =>
                                    void removeBackground(background)
                                  }
                                  className="absolute right-2 top-2 rounded-md bg-black/60 p-1 text-white/80 pointer-fine:opacity-0 transition-opacity pointer-fine:hover:text-white pointer-fine:group-hover:opacity-100"
                                  aria-label={`Remove ${background.name}`}
                                >
                                  <Icon name="trash" size="xs" />
                                </button>
                              </div>
                            );
                          },
                        )}

                        {isUnauthenticated && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <a
                                href="/sign-in"
                                target="_blank"
                                rel="noreferrer"
                                className="group relative flex flex-col rounded-xl border border-primary/20 bg-gradient-to-br from-primary/10 via-rm-accent/10 to-rm-accent/5 p-2.5 text-left outline-none transition-ui pointer-fine:hover:border-primary/50 pointer-fine:hover:from-primary/15 pointer-fine:hover:to-rm-accent/15"
                              >
                                <div className="mb-2 flex h-16 w-full flex-col items-center justify-center rounded-lg bg-gradient-to-tr from-primary/20 to-rm-accent/20 text-primary transition-ui">
                                  <Icon
                                    name="lock"
                                    size="md"
                                    className="text-rm-accent transition-transform"
                                  />
                                </div>
                                <span className="text-ui-xs font-semibold text-primary-foreground/90 pointer-fine:group-hover:text-primary">
                                  Upload Custom
                                </span>
                              </a>
                            </TooltipTrigger>
                            <TooltipContent side="top" sideOffset={8}>
                              Sign in to upload custom backgrounds
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                      {isLoadingBackgrounds && (
                        <p className="px-1 text-ui-xs font-medium text-rm-text-muted">
                          Loading saved backgrounds...
                        </p>
                      )}
                      {uploadError && (
                        <p className="px-1 text-ui-xs font-medium text-destructive">
                          {uploadError}
                        </p>
                      )}
                    </div>

                    {/* Always Preview Video Toggle */}
                    <div className="flex items-center justify-between p-3.5 rounded-xl bg-rm-bg-elevated/50 border border-rm-border pointer-fine:hover:bg-rm-bg-hover transition-ui max-w-[480px]">
                      <div>
                        <h4 className="text-ui-sm font-semibold text-rm-text">
                          Always Preview Video
                        </h4>
                        <p className="text-ui-2xs text-rm-text-muted">
                          Show preview modal before starting video chat
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          updateUserSettings(
                            (current: any) => ({
                              ...current,
                              alwaysPreviewVideo: !current.alwaysPreviewVideo,
                            }),
                            settingsUserId,
                          );
                        }}
                        aria-label={`Always preview video: ${vSettings.alwaysPreviewVideo ? "On" : "Off"}`}
                        aria-pressed={vSettings.alwaysPreviewVideo}
                        className={cn(
                          "relative w-10 h-5 rounded-full transition-colors duration-200 outline-none",
                          vSettings.alwaysPreviewVideo
                            ? "bg-primary"
                            : "bg-rm-bg-elevated border border-rm-border",
                        )}
                      >
                        <span
                          className={cn(
                            "absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-200",
                            vSettings.alwaysPreviewVideo && "translate-x-5",
                          )}
                        />
                      </button>
                    </div>
                  </div>
                )}

                {activeTab === "appearance" && (
                  <div className="animate-in fade-in duration-150">
                    <h1 className="text-ui-xl font-semibold text-rm-text mb-1">
                      Appearance
                    </h1>
                    <p className="text-ui-sm text-rm-text-muted mb-8">
                      Choose your preferred theme.
                    </p>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                      {[
                        { id: "dark", label: "Dark", preview: "bg-[#0f0f11]" },
                        {
                          id: "light",
                          label: "Light",
                          preview: "bg-[#f2f3f5]",
                        },
                        {
                          id: "system",
                          label: "System",
                          preview:
                            "bg-gradient-to-br from-[#0f0f11] to-[#f2f3f5]",
                        },
                        {
                          id: "miku-dark",
                          label: "Miku Dark",
                          preview: "bg-[#0c0b14] border border-[#39c5bb]/30",
                        },
                        {
                          id: "miku-light",
                          label: "Miku Light",
                          preview: "bg-[#f3faf9] border border-[#00a399]/30",
                        },
                      ].map((t) => (
                        <button
                          type="button"
                          key={t.id}
                          onClick={() => setTheme(t.id)}
                          className={cn(
                            "rounded-xl border-2 p-1 transition-ui",
                            theme === t.id
                              ? "border-primary ring-2 ring-primary/20"
                              : "border-rm-border pointer-fine:hover:border-rm-text-muted/30",
                          )}
                        >
                          <div
                            className={cn("h-16 rounded-lg mb-2", t.preview)}
                          />
                          <span className="text-ui-xs font-semibold text-rm-text">
                            {t.label}
                          </span>
                        </button>
                      ))}
                    </div>

                    <div className="mt-8 bg-rm-bg-elevated/40 border border-rm-border rounded-xl p-5">
                      <div className="flex items-start gap-3">
                        <div className="p-2.5 rounded-lg bg-primary/10 text-primary border border-primary/20">
                          <Icon name="monitor" size="lg" />
                        </div>
                        <div>
                          <h4 className="text-ui-sm font-semibold text-rm-text mb-1">
                            Visual Comfort
                          </h4>
                          <p className="text-ui-xs text-rm-text-muted">
                            Our dark mode uses true black and slate tones to
                            reduce eye strain.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </DialogSurface>
      </DialogPortal>
    </Dialog>
  );
}

function TabBtn({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "shrink-0 flex items-center md:justify-start justify-center rounded-full md:rounded-lg px-4 md:px-3 py-2 text-ui-sm md:text-ui-sm font-semibold md:font-medium transition-colors w-full text-left",
        active
          ? "bg-primary text-primary-foreground md:bg-primary/10 md:text-primary"
          : "text-rm-text-secondary pointer-fine:hover:bg-rm-bg-hover pointer-fine:hover:text-rm-text bg-rm-bg-elevated/50 md:bg-transparent",
      )}
    >
      {label}
    </button>
  );
}
