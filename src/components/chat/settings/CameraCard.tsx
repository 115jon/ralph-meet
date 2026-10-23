import InlineEmojiText from "@/components/chat/InlineEmojiText";
import { SettingsSwitch } from "@/components/chat/SettingsSwitch";
import { Button, Spinner } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { IconButton } from "@/components/ui/IconButton";
import { REVEAL } from "@/components/ui/interaction";
import { describeApiError } from "@/lib/api-errors";
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
import { getAuthAssetUrl, isDesktop } from "@/lib/platform";
import { useMediaDevices } from "@/lib/useMediaDevices";
import { cn } from "@/lib/utils";
import type {
  CameraBackgroundSetting,
  CustomCameraBackground,
} from "@/stores/useVoiceSettingsStore";
import { useVoiceSettingsStore } from "@/stores/useVoiceSettingsStore";
import { useUser } from "@kova/react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
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
import {
  classifyMediaError,
  describeMediaProblem,
  useDeviceAccess,
} from "./useDeviceAccess";

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

/** Why the preview is not showing video. */
type PreviewProblem = "denied" | "missing" | "busy" | "unknown" | null;

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
  children: ReactNode;
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
        // Sits on the photo, so it keeps its own scrim and ink.
        <IconButton
          aria-label={`Remove ${label}`}
          icon="trash"
          size="xs"
          variant="plain"
          onClick={onRemove}
          className={cn(
            "absolute right-1.5 top-1.5 bg-black/60 text-white",
            REVEAL,
          )}
        />
      ) : null}
    </div>
  );
}

/**
 * The compact empty block (14.1) that replaces the preview when there is no
 * camera, or no permission to use it.
 */
function PreviewState({
  title,
  body,
  action,
  busy,
  onAction,
}: {
  title: string;
  body: string;
  action: string;
  busy?: boolean;
  onAction: () => void;
}) {
  return (
    <div
      role="status"
      className="flex w-full max-w-[480px] flex-col items-center gap-3 rounded-md bg-rm-tint-1 px-6 py-8 text-center"
    >
      <Icon name="cameraOff" size="2xl" className="text-rm-text-muted" />
      <div className="flex flex-col gap-1">
        <p className="text-ui-md font-semibold text-rm-text">{title}</p>
        <p className="max-w-[36ch] text-pretty text-ui-sm text-rm-text-secondary">
          {body}
        </p>
      </div>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        loading={busy}
        onClick={onAction}
      >
        {action}
      </Button>
    </div>
  );
}

export type CameraCardProps = {
  /**
   * Whose voice settings to edit. Defaults to the signed-in user; rooms pass
   * their room-scoped id.
   */
  settingsUserId?: string | null;
  /** Start the preview on mount (the camera dialog). Studio waits to be asked. */
  autoPreview?: boolean;
  /** Rows only, without the card frame (the camera dialog is the frame). */
  bare?: boolean;
};

export default function CameraCard({
  settingsUserId: settingsUserIdProp,
  autoPreview = false,
  bare = false,
}: CameraCardProps = {}) {
  const { user } = useUser();
  const settingsUserId =
    settingsUserIdProp !== undefined ? settingsUserIdProp : (user?.id ?? null);
  const { videoInputs } = useMediaDevices();
  const { status: accessStatus, rescan } = useDeviceAccess("videoinput");
  const accessNone = accessStatus === "none";
  const vSettings = useVoiceSettingsStore(
    useShallow((s) => s.getSettings(settingsUserId)),
  );
  const setDevice = useVoiceSettingsStore((s) => s.setDevice);
  const updateUserSettings = useVoiceSettingsStore((s) => s.updateUserSettings);

  // The preview turns the camera on, so it waits to be asked (unless the
  // surface exists to show it).
  const [previewOn, setPreviewOn] = useState(autoPreview);
  const [previewProblem, setPreviewProblem] = useState<PreviewProblem>(null);
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);
  const [effectError, setEffectError] = useState(false);
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

  const noCamera = accessNone || previewProblem === "missing";

  const applyPreviewStream = useCallback(
    async (
      stream: MediaStream | null,
      cameraBackground: CameraBackgroundSetting,
      customCameraBackgrounds: CustomCameraBackground[],
    ) => {
      const requestId = ++previewRequestIdRef.current;
      previewEffectRef.current?.stop?.();
      previewEffectRef.current = null;
      setEffectError(false);

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
      } catch {
        if (previewRequestIdRef.current === requestId) {
          // Show the plain camera and say why the background is missing.
          setEffectError(true);
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
        // Guests in a room have no account to sync to; say so plainly.
        setUploadError(
          (error as { status?: number })?.status === 401
            ? "Sign in to sync uploaded backgrounds."
            : describeApiError(error, "load your saved backgrounds"),
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
    if (!previewOn || accessNone) return undefined;
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

        setPreviewProblem(null);
        webcamStreamRef.current = stream;
        await applyPreviewStream(
          stream,
          latestCameraBackgroundRef.current,
          latestCustomCameraBackgroundsRef.current,
        );
        // A first grant turns "Camera 1" into real names.
        void rescan();
      } catch (err) {
        if (active) {
          webcamStreamRef.current = null;
          setPreviewStream(null);
          setPreviewProblem(classifyMediaError(err));
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
    accessNone,
    applyPreviewStream,
    previewOn,
    previewAttempt,
    rescan,
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

  const retryPreview = async () => {
    setPreviewProblem(null);
    await rescan();
    setPreviewOn(true);
    setPreviewAttempt((n) => n + 1);
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
      setUploadError(
        (error as { status?: number })?.status === 401
          ? "Sign in to upload backgrounds."
          : describeApiError(error, "upload that image"),
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
        setUploadError(describeApiError(error, "remove that background"));
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

  const starting = previewOn && !previewStream && !previewProblem && !noCamera;

  const deniedBody = isDesktop()
    ? "Allow Ralph Meet to use your camera in your system's privacy settings, then try again."
    : "Allow camera access from the lock icon in your browser's address bar. If it's already allowed, check your system's privacy settings.";

  let preview: ReactNode;
  if (noCamera) {
    preview = (
      <PreviewState
        title="No camera found"
        body="Plug in a camera, then try again."
        action="Retry"
        onAction={() => void retryPreview()}
      />
    );
  } else if (previewProblem === "denied") {
    preview = (
      <PreviewState
        title="Camera access is off"
        body={deniedBody}
        action="Try again"
        onAction={() => void retryPreview()}
      />
    );
  } else {
    preview = (
      // A media surface: the black frame and white ink are the video's.
      <div className="relative flex aspect-video w-full max-w-[480px] items-center justify-center overflow-hidden rounded-md bg-black">
        {previewOn && previewStream ? (
          <VideoPlayer
            stream={previewStream}
            isLocal={true}
            className="h-full w-full bg-black object-contain"
          />
        ) : starting ? (
          <span role="status" className="flex items-center justify-center">
            <Spinner className="size-6 text-white/70" />
            <span className="sr-only">Starting camera</span>
          </span>
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
            setPreviewProblem(null);
            setPreviewOn((on) => !on);
          }}
          className={cn(
            "absolute bottom-3 left-1/2 -translate-x-1/2",
            previewOn && "bg-black/60 text-white [--hover-o:0.16]",
          )}
        >
          <Icon name={previewOn ? "cameraOff" : "camera"} size="sm" />
          {previewOn ? "Stop preview" : "Preview camera"}
        </Button>
      </div>
    );
  }

  const previewFooter =
    previewProblem === "busy" || previewProblem === "unknown" ? (
      <RowError>{describeMediaProblem(previewProblem, "videoinput")}</RowError>
    ) : effectError ? (
      <RowError>
        Unable to apply that background. Your camera shows without it.
      </RowError>
    ) : null;

  const rows = (
    <>
      <SettingsRow id="camera-preview" layout="block" footer={previewFooter}>
        {() => preview}
      </SettingsRow>

      {noCamera ? null : (
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
      )}

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
    </>
  );

  if (bare) {
    return <ul className="divide-y divide-rm-border">{rows}</ul>;
  }
  return <SettingsCard id="camera">{rows}</SettingsCard>;
}
