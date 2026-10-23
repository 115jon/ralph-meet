import InlineEmojiText from "@/components/chat/InlineEmojiText";
import { SettingsSwitch } from "@/components/chat/SettingsSwitch";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
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
import { useCallback, useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/shallow";
import { VideoPlayer } from "../../voice/VideoPlayer";
import {
  RowError,
  rovingKeyDown,
  SettingsCard,
  SettingsRow,
  SettingsSelect,
  type RowIds,
} from "./primitives";

const BACKGROUND_OPTIONS: Array<{
  id: string;
  label: string;
  value: CameraBackgroundSetting;
}> = [
  { id: "none", label: "None", value: { type: "none" } },
  { id: "blur", label: "Blur", value: { type: "blur", strength: "strong" } },
];

export function describeCameraQuality(id: string) {
  const profile = CAMERA_QUALITY_PROFILES.find((item) => item.id === id);
  return profile ? `${profile.label}, ${profile.fps} fps` : id;
}

function BackgroundTile({
  selected,
  label,
  onSelect,
  children,
  onRemove,
}: {
  selected: boolean;
  label: string;
  onSelect: () => void;
  children: React.ReactNode;
  onRemove?: () => void;
}) {
  return (
    <div className="group relative">
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        aria-label={label}
        tabIndex={selected ? 0 : -1}
        data-roving
        onClick={onSelect}
        className="flex w-full flex-col gap-1.5 rounded-md text-left"
      >
        <span
          className={cn(
            "relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-md bg-rm-tint-1 text-rm-text-secondary",
            selected
              ? "ring-2 ring-primary ring-offset-2 ring-offset-rm-bg-surface"
              : "ring-1 ring-rm-border-strong",
          )}
        >
          {children}
          {selected ? (
            <span className="absolute left-1.5 top-1.5 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <Icon name="check" size="xs" />
            </span>
          ) : null}
        </span>
        <span
          className={cn(
            "truncate px-0.5 text-ui-sm",
            selected ? "font-medium text-rm-text" : "text-rm-text-secondary",
          )}
        >
          <InlineEmojiText text={label} />
        </span>
      </button>
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${label}`}
          className="absolute right-1.5 top-1.5 flex size-6 items-center justify-center rounded-sm bg-black/60 text-white pointer-fine:opacity-0 transition-opacity duration-150 pointer-fine:group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
        >
          <Icon name="trash" size="xs" />
        </button>
      ) : null}
    </div>
  );
}

export default function CameraCard() {
  const { user } = useUser();
  const settingsUserId = user?.id ?? null;
  const { videoInputs } = useMediaDevices();
  const vSettings = useVoiceSettingsStore(
    useShallow((s) => s.getSettings(settingsUserId)),
  );
  const setDevice = useVoiceSettingsStore((s) => s.setDevice);
  const updateUserSettings = useVoiceSettingsStore((s) => s.updateUserSettings);

  // The preview turns the camera on, so it waits to be asked.
  const [previewOn, setPreviewOn] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);
  const webcamStreamRef = useRef<MediaStream | null>(null);
  const previewEffectRef = useRef<any>(null);
  const previewRequestIdRef = useRef(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isLoadingBackgrounds, setIsLoadingBackgrounds] = useState(false);
  const [isUploadingBackground, setIsUploadingBackground] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
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

  // Saved backgrounds
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
            : "Couldn't load your saved backgrounds.",
        );
      })
      .finally(() => {
        if (!cancelled) setIsLoadingBackgrounds(false);
      });

    return () => {
      cancelled = true;
    };
  }, [settingsUserId, updateUserSettings]);

  // Webcam stream lifecycle, only while the preview is on.
  useEffect(() => {
    if (!previewOn) return undefined;
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

        setPreviewError(null);
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
          setPreviewError(
            "Couldn't start your camera. Check that Ralph Meet has camera permission and no other app is using it.",
          );
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
    applyPreviewStream,
    previewOn,
    vSettings.videoDeviceId,
    vSettings.cameraQuality,
  ]);

  // Background effect lifecycle
  useEffect(() => {
    if (!previewOn) return;
    void applyPreviewStream(
      webcamStreamRef.current,
      vSettings.cameraBackground,
      vSettings.customCameraBackgrounds ?? [],
    );
  }, [
    applyPreviewStream,
    previewOn,
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
            : "Couldn't upload that image. Try another.",
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
            : "Couldn't remove that background. Try again.",
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

  const cameraOptions = videoInputs
    .filter((d) => d.deviceId)
    .map((d) => ({
      value: d.deviceId,
      label:
        d.label || (d.deviceId === "default" ? "Default camera" : "Camera"),
    }));
  const selectedCamera = vSettings.videoDeviceId || "default";
  if (!cameraOptions.some((option) => option.value === selectedCamera)) {
    cameraOptions.unshift({ value: selectedCamera, label: "Default camera" });
  }

  const currentBgId =
    vSettings.cameraBackground.type === "blur"
      ? "blur"
      : vSettings.cameraBackground.type === "image"
        ? `image-${vSettings.cameraBackground.id}`
        : "none";

  const setBackground = (value: CameraBackgroundSetting) =>
    updateUserSettings(
      (current: any) => ({ ...current, cameraBackground: value }),
      settingsUserId ?? undefined,
    );

  return (
    <SettingsCard id="camera">
      <SettingsRow
        id="camera-preview"
        layout="block"
        footer={previewError ? <RowError>{previewError}</RowError> : null}
      >
        {() => (
          <div className="relative flex aspect-video w-full max-w-[480px] items-center justify-center overflow-hidden rounded-md bg-black">
            {previewOn && previewStream ? (
              <VideoPlayer
                stream={previewStream}
                isLocal={true}
                className="h-full w-full bg-black object-contain"
              />
            ) : (
              <Icon
                name="cameraOff"
                size="2xl"
                className="text-white/40"
                aria-hidden
              />
            )}
            <Button
              type="button"
              variant={previewOn ? "secondary" : "default"}
              size="sm"
              aria-pressed={previewOn}
              onClick={() => {
                setPreviewError(null);
                setPreviewOn((on) => !on);
              }}
              className={cn(
                "absolute bottom-3 left-1/2 -translate-x-1/2",
                previewOn &&
                  "bg-black/60 text-white backdrop-blur-sm [--hover-o:0.16]",
              )}
            >
              <Icon name={previewOn ? "cameraOff" : "camera"} size="sm" />
              {previewOn ? "Stop preview" : "Preview camera"}
            </Button>
          </div>
        )}
      </SettingsRow>

      <SettingsRow id="camera">
        {(ids) => (
          <SettingsSelect
            ids={ids}
            value={selectedCamera}
            options={cameraOptions}
            renderLabel={(option) => <InlineEmojiText text={option.label} />}
            onValueChange={(val) => {
              const device = videoInputs.find((d) => d.deviceId === val);
              setDevice("video", val, settingsUserId ?? undefined, {
                label: device?.label,
                groupId: device?.groupId,
              });
            }}
          />
        )}
      </SettingsRow>

      <SettingsRow id="camera-quality">
        {(ids) => (
          <SettingsSelect
            ids={ids}
            value={vSettings.cameraQuality}
            options={CAMERA_QUALITY_PROFILES.map((profile) => ({
              value: profile.id,
              label: describeCameraQuality(profile.id),
            }))}
            onValueChange={(value) =>
              updateUserSettings(
                (current: any) => ({ ...current, cameraQuality: value }),
                settingsUserId ?? undefined,
              )
            }
          />
        )}
      </SettingsRow>

      <SettingsRow
        id="camera-background"
        layout="block"
        footer={
          <>
            {isLoadingBackgrounds ? (
              <p
                role="status"
                className="mt-3 text-ui-xs text-rm-text-secondary"
              >
                Loading saved backgrounds…
              </p>
            ) : null}
            {uploadError ? <RowError>{uploadError}</RowError> : null}
          </>
        }
      >
        {(ids: RowIds) => (
          <div
            role="radiogroup"
            aria-labelledby={ids.labelId}
            aria-describedby={ids.descId}
            onKeyDown={(event) =>
              rovingKeyDown(event, { grid: true, select: true })
            }
            className="grid grid-cols-2 gap-3 @min-[560px]:grid-cols-4"
          >
            {BACKGROUND_OPTIONS.map((option) => (
              <BackgroundTile
                key={option.id}
                label={option.label}
                selected={currentBgId === option.id}
                onSelect={() => setBackground(option.value)}
              >
                {option.id === "none" ? (
                  <Icon name="ban" size="lg" />
                ) : (
                  <>
                    <span className="absolute inset-0 bg-gradient-to-tr from-primary/30 via-rm-accent/20 to-rm-accent/40 blur-[8px]" />
                    <Icon
                      name="sparkle"
                      size="lg"
                      className="relative text-rm-text"
                    />
                  </>
                )}
              </BackgroundTile>
            ))}
            {(vSettings.customCameraBackgrounds ?? []).map((background) => (
              <BackgroundTile
                key={background.id}
                label={background.name}
                selected={currentBgId === `image-${background.id}`}
                onSelect={() =>
                  setBackground({ type: "image", id: background.id })
                }
                onRemove={() => void removeBackground(background)}
              >
                <img
                  src={
                    background.url
                      ? getAuthAssetUrl(background.url)
                      : background.dataUrl
                  }
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover"
                />
              </BackgroundTile>
            ))}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploadingBackground}
              className="flex aspect-video w-full flex-col items-center justify-center gap-1 rounded-md border border-dashed border-rm-field-edge text-ui-sm text-rm-text-secondary transition-colors duration-150 pointer-fine:hover:bg-rm-tint-1 pointer-fine:hover:text-rm-text disabled:opacity-45"
            >
              <Icon name="upload" size="md" />
              {isUploadingBackground ? "Uploading…" : "Upload image"}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept={CAMERA_BACKGROUND_ACCEPT}
              className="hidden"
              onChange={handleUpload}
              aria-label="Upload a background image"
            />
          </div>
        )}
      </SettingsRow>

      <SettingsRow id="always-preview-video" layout="inline">
        {(ids) => (
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
            labelledBy={ids.labelId}
            describedBy={ids.descId}
          />
        )}
      </SettingsRow>
    </SettingsCard>
  );
}
