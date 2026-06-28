import { CustomSelect } from "@/components/ui/CustomSelect";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
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
import { useUser } from "@kova/react";
import { Ban, Check, Sparkles, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/shallow";
import { VideoPlayer } from "../voice/VideoPlayer";

const BACKGROUND_OPTIONS: Array<{
  id: string;
  label: string;
  value: CameraBackgroundSetting;
}> = [
    {
      id: "none",
      label: "None",
      value: { type: "none" },
    },
    {
      id: "blur",
      label: "Blur",
      value: { type: "blur", strength: "strong" },
    },
  ];

function backgroundOptionId(setting: CameraBackgroundSetting): string {
  if (setting.type === "blur") return "blur";
  if (setting.type === "image") return `image-${setting.id}`;
  return "none";
}

export default function SettingsCameraTab() {
  const { user } = useUser();
  const settingsUserId = user?.id ?? null;
  const { videoInputs } = useMediaDevices();
  const vSettings = useVoiceSettingsStore(useShallow((s) => s.getSettings(settingsUserId)));
  const setDevice = useVoiceSettingsStore((s) => s.setDevice);
  const updateUserSettings = useVoiceSettingsStore((s) => s.updateUserSettings);
  const setCurrentUser = useVoiceSettingsStore((s) => s.setCurrentUser);

  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);
  const [webcamStream, setWebcamStream] = useState<MediaStream | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isLoadingBackgrounds, setIsLoadingBackgrounds] = useState(false);
  const [isUploadingBackground, setIsUploadingBackground] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  // Load camera backgrounds
  useEffect(() => {
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
        }, settingsUserId ?? undefined);
      })
      .catch((error) => {
        if (cancelled) return;
        const status = (error as any)?.status;
        setUploadError(status === 401 ? "Sign in to sync uploaded backgrounds." : "Could not load saved backgrounds.");
      })
      .finally(() => {
        if (!cancelled) setIsLoadingBackgrounds(false);
      });

    return () => {
      cancelled = true;
    };
  }, [settingsUserId, updateUserSettings]);

  // 1. Webcam Stream Lifecycle
  useEffect(() => {
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

        const stream = await navigator.mediaDevices.getUserMedia({
          video: videoConstraints,
          audio: false,
        });

        if (!active) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        localStream = stream;
        setWebcamStream(stream);
      } catch (err) {
        console.error("Failed to start tab camera preview:", err);
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
  }, [vSettings.videoDeviceId, vSettings.cameraQuality]);

  // 2. Background Effect Lifecycle
  useEffect(() => {
    if (!webcamStream) {
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
  }, [webcamStream, vSettings.cameraBackground, vSettings.customCameraBackgrounds]);

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
      }), settingsUserId ?? undefined);
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
    }), settingsUserId ?? undefined);
    setUploadError(null);
  };

  const dropdownOptions = videoInputs.map((d) => ({
    value: d.deviceId,
    label: d.label || (d.deviceId === "default" ? "Default Camera" : "Camera"),
  }));

  return (
    <div className="animate-in fade-in slide-in-from-right-4 duration-300">
      <h1 className="text-2xl font-bold text-rm-text mb-2 hidden md:block">
        Camera
      </h1>
      <p className="text-sm text-rm-text-muted mb-6 md:mb-10">
        Configure your video input device, capture quality, and virtual backgrounds.
      </p>

      <div className="space-y-10">
        {/* Live Video Preview Box */}
        <section className="space-y-4">
          <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-rm-text-muted">
            Camera Preview
          </h3>
          <div className="relative aspect-video w-full max-w-[480px] overflow-hidden rounded-xl bg-black border border-rm-border flex items-center justify-center">
            {previewStream && (
              <VideoPlayer stream={previewStream} isLocal={true} className="h-full w-full object-contain bg-black" />
            )}
          </div>
        </section>

        <Separator className="bg-rm-border" />

        {/* Camera Selector */}
        <section className="space-y-4 max-w-[480px]">
          <Label className="text-[11px] font-bold uppercase tracking-wider text-rm-text-muted ml-1">
            Camera Device
          </Label>
          <CustomSelect
            value={vSettings.videoDeviceId || "default"}
            onChange={(val) => {
              const device = videoInputs.find((d) => d.deviceId === val);
              setDevice("video", val, settingsUserId ?? undefined, {
                label: device?.label,
                groupId: device?.groupId,
              });
            }}
            options={dropdownOptions}
            placeholder="Select camera device"
          />
        </section>

        <Separator className="bg-rm-border" />

        {/* Capture Quality */}
        <section className="space-y-4">
          <Label className="text-[11px] font-bold uppercase tracking-wider text-rm-text-muted ml-1">
            Capture Quality
          </Label>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 max-w-[480px]">
            {CAMERA_QUALITY_PROFILES.map((profile) => {
              const isSelected = vSettings.cameraQuality === profile.id;
              return (
                <button
                  key={profile.id}
                  onClick={() => updateUserSettings((current: any) => ({ ...current, cameraQuality: profile.id }), settingsUserId ?? undefined)}
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
        </section>

        <Separator className="bg-rm-border" />

        {/* Video Background */}
        <section className="space-y-4">
          <div className="flex items-center justify-between gap-3 px-1 max-w-[480px]">
            <Label className="text-[11px] font-bold uppercase tracking-wider text-rm-text-muted">
              Video Background
            </Label>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploadingBackground}
              className="flex items-center gap-1.5 rounded-lg border border-rm-border bg-rm-bg-surface/40 px-2.5 py-1.5 text-[10px] font-black text-rm-text-muted transition-colors hover:text-rm-text"
            >
              <Upload size={12} /> {isUploadingBackground ? "Uploading" : "Upload Image"}
            </button>
            <input ref={fileInputRef} type="file" accept={CAMERA_BACKGROUND_ACCEPT} className="hidden" onChange={handleUpload} />
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 max-w-[480px]">
            {BACKGROUND_OPTIONS.map((option) => {
              const currentBgId = vSettings.cameraBackground.type === "blur"
                ? "blur"
                : vSettings.cameraBackground.type === "image"
                  ? `image-${vSettings.cameraBackground.id}`
                  : "none";
              const isSelected = currentBgId === option.id;
              return (
                <button
                  key={option.id}
                  onClick={() => updateUserSettings((current: any) => ({ ...current, cameraBackground: option.value }), settingsUserId ?? undefined)}
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
                      <div className="absolute inset-0 bg-gradient-to-tr from-primary/30 via-rm-accent/25 to-rm-accent/40 filter blur-[8px]" />
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
                  <button onClick={() => updateUserSettings((current: any) => ({ ...current, cameraBackground: { type: "image", id: background.id } }), settingsUserId ?? undefined)} className="block w-full p-2 text-left">
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
          </div>
          {isLoadingBackgrounds && <p className="px-1 text-xs font-medium text-rm-text-muted">Loading saved backgrounds...</p>}
          {uploadError && <p className="px-1 text-xs font-medium text-destructive">{uploadError}</p>}
        </section>

        <Separator className="bg-rm-border" />

        {/* Always Preview Video Toggle */}
        <section className="flex items-center justify-between p-3.5 rounded-xl bg-rm-bg-elevated/50 border border-rm-border hover:bg-rm-bg-hover transition-all max-w-[480px]">
          <div>
            <h4 className="text-[13px] font-bold text-rm-text">Always Preview Video</h4>
            <p className="text-[11px] text-rm-text-muted">Show preview modal before starting video chat</p>
          </div>
          <button
            onClick={() => {
              updateUserSettings((current: any) => ({
                ...current,
                alwaysPreviewVideo: !current.alwaysPreviewVideo,
              }), settingsUserId ?? undefined);
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
        </section>
      </div>
    </div>
  );
}
