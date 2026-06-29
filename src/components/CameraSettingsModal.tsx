import { BaseModal } from "@/components/ui/BaseModal";
import { createCameraBackgroundEffect } from "@/lib/camera-background-effects";
import {
  CAMERA_BACKGROUND_ACCEPT,
  deleteCameraBackground,
  getCameraBackgroundValidationError,
  listCameraBackgrounds,
  uploadCameraBackground,
} from "@/lib/camera-backgrounds";
import { buildCameraVideoConstraints } from "@/lib/camera-quality";
import { getAuthAssetUrl } from "@/lib/platform";
import { useMediaDevices } from "@/lib/useMediaDevices";
import { cn } from "@/lib/utils";
import { type CameraBackgroundSetting, type CustomCameraBackground, useVoiceSettingsStore } from "@/stores/useVoiceSettingsStore";
import { Ban, Check, Sparkles, Trash2, Upload, X } from "lucide-react";
import React, { useEffect, useRef, useState } from "react";
import { CustomSelect } from "./ui/CustomSelect";
import { VideoPlayer } from "./voice/VideoPlayer";

interface CameraSettingsModalProps {
  isClosing?: boolean;
  isOpen: boolean;
  onClose: () => void;
  isCameraActive?: boolean;
  onToggleCamera?: () => void;
  settingsUserId?: string;
}

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

export const CameraSettingsModal: React.FC<CameraSettingsModalProps> = ({
  isOpen,
  isClosing,
  onClose,
  isCameraActive = false,
  onToggleCamera,
  settingsUserId,
}) => {
  const { videoInputs } = useMediaDevices();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const settings = useVoiceSettingsStore((s) => s.getSettings(settingsUserId));
  const setDevice = useVoiceSettingsStore((s) => s.setDevice);
  const updateUserSettings = useVoiceSettingsStore((s) => s.updateUserSettings);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isLoadingBackgrounds, setIsLoadingBackgrounds] = useState(false);
  const [isUploadingBackground, setIsUploadingBackground] = useState(false);
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);
  const [webcamStream, setWebcamStream] = useState<MediaStream | null>(null);

  useEffect(() => {
    if (!isOpen) return;

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
        setUploadError(status === 401 ? "Sign in to sync uploaded backgrounds." : "Could not load saved backgrounds.");
      })
      .finally(() => {
        if (!cancelled) setIsLoadingBackgrounds(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, settingsUserId, updateUserSettings]);

  const selectedBackgroundId = backgroundOptionId(settings.cameraBackground);
  const selectedDeviceId = settings.videoDeviceId || "default";

  // 1. Webcam Stream Lifecycle
  useEffect(() => {
    if (!isOpen) return;

    let active = true;
    let localStream: MediaStream | null = null;

    const startWebcam = async () => {
      try {
        const videoConstraints = buildCameraVideoConstraints({
          deviceId: selectedDeviceId,
          exactDevice: selectedDeviceId !== "default",
          qualityId: settings.cameraQuality,
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
        console.error("Failed to start preview stream:", err);
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
  }, [isOpen, selectedDeviceId, settings.cameraQuality]);

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
      if (videoTrack && settings.cameraBackground.type !== "none") {
        try {
          const effect = await createCameraBackgroundEffect(
            videoTrack,
            settings.cameraBackground,
            settings.customCameraBackgrounds || []
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
  }, [webcamStream, settings.cameraBackground, settings.customCameraBackgrounds]);

  if (!isOpen) return null;

  const selectDevice = (deviceId: string) => {
    const device = videoInputs.find((d) => d.deviceId === deviceId);
    setDevice("video", deviceId, settingsUserId, {
      label: device?.label,
      groupId: device?.groupId,
    });
  };

  const selectBackground = (cameraBackground: CameraBackgroundSetting) => {
    updateUserSettings((current) => ({ ...current, cameraBackground }), settingsUserId);
  };

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

  const handlePrimary = () => {
    if (!isCameraActive) onToggleCamera?.();
    onClose();
  };

  const dropdownOptions = videoInputs.map((d) => ({
    value: d.deviceId,
    label: d.label || (d.deviceId === "default" ? "Default Camera" : "Camera"),
  }));

  return (
    <BaseModal onClose={onClose}>
      <div
        className={cn("fixed inset-0 z-[200] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm", isClosing ? "animate-out fade-out duration-200" : "animate-in fade-in duration-200")}
        onClick={onClose}
        role="presentation"
      >
        <div
          className={cn("flex h-full max-h-[640px] w-full max-w-[540px] flex-col overflow-hidden rounded-2xl border border-rm-border bg-rm-bg-primary shadow-2xl pointer-events-auto", isClosing ? "animate-out fade-out zoom-out-95 duration-200" : "animate-in zoom-in-95 duration-200")}
          onClick={(event) => event.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-labelledby="camera-settings-title"
        >
          {/* Header */}
          <div className="flex items-center justify-between p-5 pb-4 border-b border-rm-border/50">
            <h2 id="camera-settings-title" className="text-lg font-bold text-rm-text">Ready to video chat?</h2>
            <button type="button" onClick={onClose} className="p-1 rounded-full text-rm-text-muted hover:bg-rm-bg-hover hover:text-rm-text transition-all">
              <X size={18} />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 space-y-5 overflow-y-auto p-5 custom-scrollbar">
            {/* Live Video Preview Box */}
            <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black border border-rm-border flex items-center justify-center">
              {previewStream && (
                <VideoPlayer stream={previewStream} isLocal={true} className="h-full w-full object-contain bg-black" />
              )}
            </div>

            {/* Camera dropdown selection */}
            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-wider text-rm-text-muted ml-1">Camera</label>
              <CustomSelect
                value={selectedDeviceId}
                onChange={selectDevice}
                options={dropdownOptions}
                placeholder="Select camera device"
              />
            </div>

            {/* Background selection */}
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3 px-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-rm-text-muted">Video Background</label>
                <button type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploadingBackground}
                  className="flex items-center gap-1.5 rounded-lg border border-rm-border bg-rm-bg-surface/40 px-2.5 py-1.5 text-[10px] font-black text-rm-text-muted transition-colors hover:text-rm-text"
                >
                  <Upload size={12} /> {isUploadingBackground ? "Uploading" : "Upload Image"}
                </button>
                <input ref={fileInputRef} type="file" accept={CAMERA_BACKGROUND_ACCEPT} className="hidden" onChange={handleUpload} />
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {BACKGROUND_OPTIONS.map((option) => {
                  const isSelected = selectedBackgroundId === option.id;
                  return (
                    <button type="button"
                      key={option.id}
                      onClick={() => selectBackground(option.value)}
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
                          <div className="absolute inset-0 bg-linear-to-tr from-primary/30 via-rm-accent/25 to-transparent filter blur-[8px]" />
                          <div className="absolute inset-0 bg-black/15" />
                          <Sparkles size={20} className="relative z-10 text-white/80" />
                        </div>
                      )}
                      <span className={cn("text-xs font-bold", isSelected ? "text-primary" : "text-rm-text")}>{option.label}</span>
                      {isSelected && <div className="absolute top-2 right-2 rounded-full bg-primary p-0.5 text-primary-foreground"><Check size={10} /></div>}
                    </button>
                  );
                })}

                {(settings.customCameraBackgrounds ?? []).map((background) => {
                  const isSelected = selectedBackgroundId === `image-${background.id}`;
                  return (
                    <div
                      key={background.id}
                      className={cn(
                        "group relative overflow-hidden rounded-xl border bg-rm-bg-surface/40 outline-none transition-all",
                        isSelected ? "border-primary ring-1 ring-primary" : "border-rm-border hover:border-rm-text/20"
                      )}
                    >
                      <button type="button" onClick={() => selectBackground({ type: "image", id: background.id })} className="block w-full p-2 text-left">
                        <img src={background.url ? getAuthAssetUrl(background.url) : background.dataUrl} alt="" className="h-16 w-full rounded-lg object-cover" />
                        <div className="mt-2 flex items-center justify-between gap-2 px-1">
                          <span className={cn("truncate text-xs font-bold", isSelected ? "text-primary" : "text-rm-text")}>{background.name}</span>
                        </div>
                      </button>
                      {isSelected && <div className="absolute top-3 right-8 rounded-full bg-primary p-0.5 text-primary-foreground"><Check size={10} /></div>}
                      <button type="button"
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
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between border-t border-rm-border bg-rm-bg-surface/20 p-4">
            {/* Always preview toggle */}
            <div className="flex items-center gap-2.5">
              <button type="button"
                onClick={() => {
                  updateUserSettings((current) => ({
                    ...current,
                    alwaysPreviewVideo: !current.alwaysPreviewVideo,
                  }), settingsUserId);
                }}
                className={cn(
                  "relative w-9 h-5 rounded-full transition-colors duration-200 outline-none",
                  settings.alwaysPreviewVideo ? "bg-primary" : "bg-rm-bg-elevated border border-rm-border"
                )}
              >
                <span className={cn(
                  "absolute top-0.5 left-0.5 h-3.5 w-3.5 rounded-full bg-white shadow transition-transform duration-200",
                  settings.alwaysPreviewVideo && "translate-x-4.5"
                )} />
              </button>
              <span className="text-[11px] font-medium text-rm-text-secondary select-none">Always preview video</span>
            </div>

            <div className="flex items-center gap-2">
              <button type="button" onClick={onClose} className="px-4 py-2 text-xs font-bold text-rm-text-muted hover:text-rm-text transition-colors">
                Cancel
              </button>
              <button type="button"
                onClick={handlePrimary}
                className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2 text-xs font-bold text-primary-foreground shadow-xl shadow-primary/20 transition-all hover:brightness-110 active:scale-95"
              >
                <span>{isCameraActive ? "Done" : "Turn On Camera"}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </BaseModal>
  );
};
