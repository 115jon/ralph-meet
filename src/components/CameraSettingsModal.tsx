import { BaseModal } from "@/components/ui/BaseModal";
import {
  CAMERA_BACKGROUND_ACCEPT,
  deleteCameraBackground,
  getCameraBackgroundValidationError,
  listCameraBackgrounds,
  uploadCameraBackground,
} from "@/lib/camera-backgrounds";
import { CAMERA_QUALITY_PROFILES, type CameraQualityId } from "@/lib/camera-quality";
import { getAuthAssetUrl } from "@/lib/platform";
import { type MediaDeviceInfo_Custom, useMediaDevices } from "@/lib/useMediaDevices";
import { cn } from "@/lib/utils";
import { type CameraBackgroundSetting, type CustomCameraBackground, useVoiceSettingsStore } from "@/stores/useVoiceSettingsStore";
import { Check, Image, Info, Sparkles, Trash2, Upload, Video } from "lucide-react";
import React, { useEffect, useRef, useState } from "react";

interface CameraSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  isCameraActive?: boolean;
  onToggleCamera?: () => void;
  settingsUserId?: string;
}

const BACKGROUND_OPTIONS: Array<{
  id: string;
  label: string;
  description: string;
  value: CameraBackgroundSetting;
}> = [
  {
    id: "none",
    label: "None",
    description: "Send the raw camera feed.",
    value: { type: "none" },
  },
  {
    id: "blur-light",
    label: "Light Blur",
    description: "Subtle background blur once processing is enabled.",
    value: { type: "blur", strength: "light" },
  },
  {
    id: "blur-strong",
    label: "Strong Blur",
    description: "Zoom-style privacy blur once processing is enabled.",
    value: { type: "blur", strength: "strong" },
  },
];

function backgroundOptionId(setting: CameraBackgroundSetting): string {
  if (setting.type === "blur") return `blur-${setting.strength}`;
  if (setting.type === "image") return `image-${setting.id}`;
  return "none";
}

export const CameraSettingsModal: React.FC<CameraSettingsModalProps> = ({
  isOpen,
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

  if (!isOpen) return null;

  const selectedBackgroundId = backgroundOptionId(settings.cameraBackground);
  const selectedDeviceId = settings.videoDeviceId || "default";

  const selectDevice = (device: MediaDeviceInfo_Custom) => {
    setDevice("video", device.deviceId, settingsUserId, {
      label: device.label,
      groupId: device.groupId,
    });
  };

  const selectQuality = (cameraQuality: CameraQualityId) => {
    updateUserSettings((current) => ({ ...current, cameraQuality }), settingsUserId);
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

  return (
    <BaseModal onClose={onClose}>
      <div
        className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm animate-in fade-in duration-200"
        onClick={onClose}
        role="presentation"
      >
        <div
          className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-rm-border bg-rm-bg-primary shadow-2xl animate-in zoom-in-95 slide-in-from-bottom-4 duration-300"
          onClick={(event) => event.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-labelledby="camera-settings-title"
        >
          <div className="p-6 pb-3">
            <div className="mb-1 flex items-center gap-3">
              <div className="rounded-lg bg-primary/10 p-2 text-primary">
                <Video size={24} />
              </div>
              <h2 id="camera-settings-title" className="text-xl font-black text-rm-text">Camera Setup</h2>
            </div>
            <p className="text-sm text-rm-text-muted">Choose a camera, request a 16:9 capture profile, and save background preferences.</p>
          </div>

          <div className="space-y-6 overflow-y-auto p-6 pt-3 custom-scrollbar">
            <section className="space-y-3">
              <h3 className="px-1 text-[10px] font-black uppercase tracking-widest text-rm-text-muted/40">Camera Source</h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {videoInputs.length === 0 ? (
                  <div className="rounded-xl border border-rm-border bg-rm-bg-surface/40 p-4 text-sm text-rm-text-muted">No cameras detected.</div>
                ) : videoInputs.map((device) => {
                  const isSelected = selectedDeviceId === device.deviceId;
                  return (
                    <button
                      key={device.deviceId}
                      onClick={() => selectDevice(device)}
                      className={cn(
                        "rounded-xl border p-3 text-left outline-none transition-all",
                        isSelected
                          ? "border-primary/50 bg-primary/10 ring-1 ring-primary/50"
                          : "border-rm-border bg-rm-bg-surface/40 hover:border-rm-text/20 hover:bg-rm-bg-surface/60"
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className={cn("truncate text-sm font-bold", isSelected ? "text-primary" : "text-rm-text")}>{device.label || "Camera"}</span>
                        {isSelected && <Check size={14} className="shrink-0 text-primary" />}
                      </div>
                      <p className="mt-1 text-[10px] text-rm-text-muted">{device.deviceId === "default" ? "System default camera" : "Video input device"}</p>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="space-y-3">
              <h3 className="px-1 text-[10px] font-black uppercase tracking-widest text-rm-text-muted/40">Quality</h3>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {CAMERA_QUALITY_PROFILES.map((profile) => {
                  const isSelected = settings.cameraQuality === profile.id;
                  return (
                    <button
                      key={profile.id}
                      onClick={() => selectQuality(profile.id)}
                      className={cn(
                        "group rounded-xl border p-3 text-left outline-none transition-all",
                        isSelected
                          ? "border-primary/50 bg-primary/10 ring-1 ring-primary/50"
                          : "border-rm-border bg-rm-bg-surface/40 hover:border-rm-text/20 hover:bg-rm-bg-surface/60"
                      )}
                    >
                      <div className="mb-1 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className={cn("text-sm font-black", isSelected ? "text-primary" : "text-rm-text")}>{profile.label}</span>
                          <span className="rounded-md bg-rm-bg-elevated/40 px-1.5 py-0.5 text-[10px] font-black text-rm-text-muted">{profile.fps} FPS</span>
                        </div>
                        {isSelected && <Check size={14} className="text-primary" />}
                      </div>
                      <p className="text-[10px] leading-tight text-rm-text-muted">{profile.width}x{profile.height} 16:9</p>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3 px-1">
                <h3 className="text-[10px] font-black uppercase tracking-widest text-rm-text-muted/40">Backgrounds</h3>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploadingBackground}
                  className="flex items-center gap-1.5 rounded-lg border border-rm-border bg-rm-bg-surface/40 px-2.5 py-1.5 text-[10px] font-black text-rm-text-muted transition-colors hover:text-rm-text"
                >
                  <Upload size={12} /> {isUploadingBackground ? "Uploading" : "Upload"}
                </button>
                <input ref={fileInputRef} type="file" accept={CAMERA_BACKGROUND_ACCEPT} className="hidden" onChange={handleUpload} />
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {BACKGROUND_OPTIONS.map((option) => {
                  const isSelected = selectedBackgroundId === option.id;
                  return (
                    <button
                      key={option.id}
                      onClick={() => selectBackground(option.value)}
                      className={cn(
                        "rounded-xl border p-3 text-left outline-none transition-all",
                        isSelected
                          ? "border-primary/50 bg-primary/10 ring-1 ring-primary/50"
                          : "border-rm-border bg-rm-bg-surface/40 hover:border-rm-text/20 hover:bg-rm-bg-surface/60"
                      )}
                    >
                      <div className="mb-2 flex h-16 items-center justify-center rounded-lg bg-rm-bg-elevated/40 text-rm-text-muted">
                        {option.value.type === "none" ? <Image size={20} /> : <Sparkles size={20} />}
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className={cn("text-xs font-black", isSelected ? "text-primary" : "text-rm-text")}>{option.label}</span>
                        {isSelected && <Check size={13} className="text-primary" />}
                      </div>
                      <p className="mt-1 line-clamp-2 text-[10px] leading-tight text-rm-text-muted">{option.description}</p>
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
                        isSelected ? "border-primary/50 ring-1 ring-primary/50" : "border-rm-border hover:border-rm-text/20"
                      )}
                    >
                      <button onClick={() => selectBackground({ type: "image", id: background.id })} className="block w-full p-2 text-left">
                        <img src={background.url ? getAuthAssetUrl(background.url) : background.dataUrl} alt="" className="h-24 w-full rounded-lg object-cover" />
                        <div className="mt-2 flex items-center justify-between gap-2 px-1">
                          <span className={cn("truncate text-xs font-black", isSelected ? "text-primary" : "text-rm-text")}>{background.name}</span>
                          {isSelected && <Check size={13} className="shrink-0 text-primary" />}
                        </div>
                      </button>
                      <button
                        onClick={() => void removeBackground(background)}
                        className="absolute right-3 top-3 rounded-md bg-black/50 p-1 text-white/70 opacity-0 transition-opacity hover:text-white group-hover:opacity-100"
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
              <div className="flex gap-3 rounded-xl border border-warning/10 bg-warning/5 p-3">
                <Info size={16} className="shrink-0 text-warning" />
                <p className="text-[10px] leading-relaxed text-warning/70">
                  Uploaded backgrounds sync to your account and support GIF, WebP, PNG, JPEG, and AVIF images up to 25 MB. MP4 and other video files are not supported.
                </p>
              </div>
            </section>
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-rm-border bg-rm-bg-surface/20 p-4">
            <button onClick={onClose} className="px-6 py-2 text-sm font-bold text-rm-text-muted/60 transition-colors hover:text-rm-text">
              Cancel
            </button>
            <button
              onClick={handlePrimary}
              className="flex items-center gap-2 rounded-xl bg-primary px-8 py-2.5 text-sm font-black text-primary-foreground shadow-xl shadow-primary/20 transition-all hover:brightness-110 active:scale-95"
            >
              <span>{isCameraActive ? "Done" : "Start Camera"}</span>
              <div className="h-1.5 w-1.5 rounded-full bg-primary-foreground/40" />
            </button>
          </div>
        </div>
      </div>
    </BaseModal>
  );
};
