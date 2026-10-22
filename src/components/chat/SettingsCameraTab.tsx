import InlineEmojiText from "@/components/chat/InlineEmojiText";
import { SettingsSwitch } from "@/components/chat/SettingsSwitch";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { useUser } from "@kova/react";
import { Ban, Check, Sparkles, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
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

function _backgroundOptionId(setting: CameraBackgroundSetting): string {
  if (setting.type === "blur") return "blur";
  if (setting.type === "image") return `image-${setting.id}`;
  return "none";
}

export default function SettingsCameraTab() {
  const { user } = useUser();
  const settingsUserId = user?.id ?? null;
  const { videoInputs } = useMediaDevices();
  const vSettings = useVoiceSettingsStore(
    useShallow((s) => s.getSettings(settingsUserId)),
  );
  const setDevice = useVoiceSettingsStore((s) => s.setDevice);
  const updateUserSettings = useVoiceSettingsStore((s) => s.updateUserSettings);
  const setCurrentUser = useVoiceSettingsStore((s) => s.setCurrentUser);

  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);
  const webcamStreamRef = useRef<MediaStream | null>(null);
  const previewEffectRef = useRef<any>(null);
  const previewRequestIdRef = useRef(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isLoadingBackgrounds, setIsLoadingBackgrounds] = useState(false);
  const [isUploadingBackground, setIsUploadingBackground] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const alwaysPreviewTitleId = useId();
  const alwaysPreviewDescriptionId = useId();
  const latestCameraBackgroundRef = useRef(vSettings.cameraBackground);
  const latestCustomCameraBackgroundsRef = useRef(
    vSettings.customCameraBackgrounds ?? [],
  );
  latestCameraBackgroundRef.current = vSettings.cameraBackground;
  latestCustomCameraBackgroundsRef.current =
    vSettings.customCameraBackgrounds ?? [];

  useEffect(() => {
    const initStore = () => {
      if (settingsUserId) {
        const storeUser = useVoiceSettingsStore.getState().currentUser;
        if (!storeUser || !storeUser.startsWith("room-")) {
          setCurrentUser(settingsUserId);
        }
      }
    };
    initStore();
  }, [settingsUserId, setCurrentUser]);

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

  // Load camera backgrounds
  useEffect(() => {
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
        }, settingsUserId ?? undefined);
      })
      .catch((error) => {
        if (cancelled) return;
        const status = (error as any)?.status;
        setUploadError(
          status === 401
            ? "Sign in to sync uploaded backgrounds."
            : "Could not load saved backgrounds.",
        );
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

        webcamStreamRef.current = stream;
        await applyPreviewStream(
          stream,
          latestCameraBackgroundRef.current,
          latestCustomCameraBackgroundsRef.current,
        );
      } catch (err) {
        console.error("Failed to start tab camera preview:", err);
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
  }, [applyPreviewStream, vSettings.videoDeviceId, vSettings.cameraQuality]);

  // 2. Background Effect Lifecycle
  useEffect(() => {
    void applyPreviewStream(
      webcamStreamRef.current,
      vSettings.cameraBackground,
      vSettings.customCameraBackgrounds ?? [],
    );
  }, [
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
        settingsUserId ?? undefined,
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
      settingsUserId ?? undefined,
    );
    setUploadError(null);
  };

  const dropdownOptions = videoInputs.map((d) => ({
    value: d.deviceId,
    label: d.label || (d.deviceId === "default" ? "Default Camera" : "Camera"),
  }));

  return (
    <div className="animate-in fade-in duration-150">
      <h1 className="text-2xl font-bold text-rm-text mb-2 hidden md:block">
        Camera
      </h1>
      <p className="text-sm text-rm-text-muted mb-6 md:mb-10">
        Configure your video input device, capture quality, and virtual
        backgrounds.
      </p>

      <div className="space-y-10">
        {/* Live Video Preview Box */}
        <section className="space-y-4">
          <h3 className="text-ui-xs font-medium text-rm-text-muted">
            Camera Preview
          </h3>
          <div className="relative aspect-video w-full max-w-[480px] overflow-hidden rounded-xl bg-black border border-rm-border flex items-center justify-center">
            {previewStream && (
              <VideoPlayer
                stream={previewStream}
                isLocal={true}
                className="h-full w-full object-contain bg-black"
              />
            )}
          </div>
        </section>

        <Separator className="bg-rm-border" />

        {/* Camera Selector */}
        <section className="space-y-4 max-w-[480px]">
          <Label className="text-ui-xs font-medium text-rm-text-muted ml-1">
            Camera Device
          </Label>
          <Select
            value={vSettings.videoDeviceId || "default"}
            onValueChange={(val) => {
              const device = videoInputs.find((d) => d.deviceId === val);
              setDevice("video", val, settingsUserId ?? undefined, {
                label: device?.label,
                groupId: device?.groupId,
              });
            }}
          >
            <SelectTrigger
              aria-label="Select camera device"
              className="w-full rounded-xl border-rm-border bg-rm-bg-elevated/50 px-4 py-3 text-rm-text hover:bg-rm-bg-elevated"
            >
              <SelectValue placeholder="Select camera device" />
            </SelectTrigger>
            <SelectContent
              position="popper"
              align="start"
              className="rounded-xl border-rm-border bg-rm-bg-floating p-1.5 text-rm-text shadow-2xl"
            >
              {dropdownOptions.map((option) => (
                <SelectItem
                  key={option.value}
                  value={option.value}
                  textValue={option.label}
                  className="text-rm-text-secondary hover:bg-rm-bg-elevated hover:text-rm-text focus:bg-rm-bg-elevated focus:text-rm-text"
                >
                  <InlineEmojiText text={option.label} />
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </section>

        <Separator className="bg-rm-border" />

        {/* Capture Quality */}
        <section className="space-y-4">
          <Label className="text-ui-xs font-medium text-rm-text-muted ml-1">
            Capture Quality
          </Label>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 max-w-[480px]">
            {CAMERA_QUALITY_PROFILES.map((profile) => {
              const isSelected = vSettings.cameraQuality === profile.id;
              return (
                <button
                  key={profile.id}
                  aria-pressed={isSelected}
                  onClick={() =>
                    updateUserSettings(
                      (current: any) => ({
                        ...current,
                        cameraQuality: profile.id,
                      }),
                      settingsUserId ?? undefined,
                    )
                  }
                  className={cn(
                    "group rounded-xl border p-3 text-left outline-none transition-ui",
                    isSelected
                      ? "border-primary bg-rm-accent-tint ring-1 ring-primary"
                      : "border-rm-border bg-rm-bg-surface/40 pointer-fine:hover:bg-rm-tint-1",
                  )}
                >
                  <div className="mb-1 flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={cn(
                          "text-xs font-semibold",
                          isSelected ? "text-rm-accent-ink" : "text-rm-text",
                        )}
                      >
                        {profile.label}
                      </span>
                      <span className="rounded-md bg-rm-bg-elevated/40 px-1 py-0.5 text-ui-2xs font-bold text-rm-text-muted">
                        {profile.fps} FPS
                      </span>
                    </div>
                    {isSelected && (
                      <Check
                        size={12}
                        aria-hidden="true"
                        className="text-rm-accent-ink"
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
        </section>

        <Separator className="bg-rm-border" />

        {/* Video Background */}
        <section className="space-y-4">
          <div className="flex items-center justify-between gap-3 px-1 max-w-[480px]">
            <Label className="text-ui-xs font-medium text-rm-text-muted">
              Video Background
            </Label>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploadingBackground}
            >
              <Upload size={12} aria-hidden="true" />
              {isUploadingBackground ? "Uploading" : "Upload Image"}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept={CAMERA_BACKGROUND_ACCEPT}
              className="hidden"
              onChange={handleUpload}
              aria-label="Upload video background image"
            />
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 max-w-[480px]">
            {BACKGROUND_OPTIONS.map((option) => {
              const currentBgId =
                vSettings.cameraBackground.type === "blur"
                  ? "blur"
                  : vSettings.cameraBackground.type === "image"
                    ? `image-${vSettings.cameraBackground.id}`
                    : "none";
              const isSelected = currentBgId === option.id;
              return (
                <button
                  key={option.id}
                  aria-pressed={isSelected}
                  onClick={() =>
                    updateUserSettings(
                      (current: any) => ({
                        ...current,
                        cameraBackground: option.value,
                      }),
                      settingsUserId ?? undefined,
                    )
                  }
                  className={cn(
                    "group relative flex flex-col rounded-xl border p-2.5 text-left outline-none transition-ui",
                    isSelected
                      ? "border-primary bg-rm-accent-tint ring-1 ring-primary"
                      : "border-rm-border bg-rm-bg-surface/40 pointer-fine:hover:bg-rm-tint-1",
                  )}
                >
                  {option.id === "none" ? (
                    <div className="mb-2 flex h-16 w-full items-center justify-center rounded-lg bg-rm-tint-1 text-rm-text-muted">
                      <Ban size={20} />
                    </div>
                  ) : (
                    <div className="relative mb-2 flex h-16 w-full items-center justify-center overflow-hidden rounded-lg bg-rm-bg-elevated/40 transition-ui">
                      <div className="absolute inset-0 bg-gradient-to-tr from-primary/30 via-rm-accent/25 to-rm-accent/40 filter blur-[8px]" />
                      <div className="absolute inset-0 bg-black/15" />
                      <Sparkles
                        size={20}
                        className="relative z-10 text-white/80"
                      />
                    </div>
                  )}
                  <span
                    className={cn(
                      "text-xs font-semibold",
                      isSelected ? "text-rm-accent-ink" : "text-rm-text",
                    )}
                  >
                    {option.label}
                  </span>
                  {isSelected && (
                    <div className="absolute top-2 right-2 rounded-full bg-primary p-0.5 text-primary-foreground">
                      <Check size={10} />
                    </div>
                  )}
                </button>
              );
            })}

            {(vSettings.customCameraBackgrounds ?? []).map((background) => {
              const currentBgId =
                vSettings.cameraBackground.type === "image"
                  ? `image-${vSettings.cameraBackground.id}`
                  : null;
              const isSelected = currentBgId === `image-${background.id}`;
              return (
                <div
                  key={background.id}
                  className={cn(
                    "group relative overflow-hidden rounded-xl border bg-rm-bg-surface/40 outline-none transition-ui",
                    isSelected
                      ? "border-primary ring-1 ring-primary"
                      : "border-rm-border pointer-fine:hover:bg-rm-tint-1",
                  )}
                >
                  <button
                    aria-pressed={isSelected}
                    onClick={() =>
                      updateUserSettings(
                        (current: any) => ({
                          ...current,
                          cameraBackground: {
                            type: "image",
                            id: background.id,
                          },
                        }),
                        settingsUserId ?? undefined,
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
                          "truncate text-xs font-bold",
                          isSelected ? "text-rm-accent-ink" : "text-rm-text",
                        )}
                      >
                        {background.name}
                      </span>
                    </div>
                  </button>
                  {isSelected && (
                    <div className="absolute top-3 right-8 rounded-full bg-primary p-0.5 text-primary-foreground">
                      <Check size={10} />
                    </div>
                  )}
                  <button
                    onClick={() => void removeBackground(background)}
                    className="absolute right-2 top-2 rounded-md bg-black/60 p-1 text-white/80 opacity-0 transition-opacity pointer-fine:hover:text-white group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
                    aria-label={`Remove ${background.name}`}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              );
            })}
          </div>
          {isLoadingBackgrounds && (
            <p className="px-1 text-xs font-medium text-rm-text-muted">
              Loading saved backgrounds...
            </p>
          )}
          {uploadError && (
            <p className="px-1 text-xs font-medium text-rm-danger-ink">
              {uploadError}
            </p>
          )}
        </section>

        <Separator className="bg-rm-border" />

        {/* Always Preview Video Toggle */}
        <section className="flex items-center justify-between gap-4 p-3.5 rounded-xl border border-rm-border max-w-[480px]">
          <div>
            <h4
              id={alwaysPreviewTitleId}
              className="text-ui-sm font-semibold text-rm-text"
            >
              Always Preview Video
            </h4>
            <p
              id={alwaysPreviewDescriptionId}
              className="text-ui-2xs text-rm-text-muted"
            >
              Show preview modal before starting video chat
            </p>
          </div>
          <SettingsSwitch
            checked={vSettings.alwaysPreviewVideo ?? false}
            onChange={() => {
              updateUserSettings(
                (current: any) => ({
                  ...current,
                  alwaysPreviewVideo: !current.alwaysPreviewVideo,
                }),
                settingsUserId ?? undefined,
              );
            }}
            ariaLabel="Always preview video"
            labelledBy={alwaysPreviewTitleId}
            describedBy={alwaysPreviewDescriptionId}
          />
        </section>
      </div>
    </div>
  );
}
