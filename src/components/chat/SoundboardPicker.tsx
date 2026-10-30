import { useMounted } from "@/hooks/useMounted";
import { describeApiError } from "@/lib/api-errors";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  apiGet,
  apiPost,
  apiUpload,
  apiDelete,
  apiPatch,
} from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { DeleteSoundDialog } from "./DeleteSoundDialog";
import { isMobileViewport } from "@/hooks/useMediaQuery";
import { PickerSurface } from "./PickerSurface";
import { PickerHeader, PickerSearch, PickerSectionLabel } from "./PickerHeader";
import {
  PICKER_RING,
  PICKER_WIDTH,
  PICKER_WIDTH_CLASS,
  handlePickerGridKeyDown,
} from "./picker-grid";
import { Icon, type IconName } from "@/components/ui/icon";
import { IconButton } from "@/components/ui/IconButton";
import { Led } from "@/components/ui/led";
import { Num } from "@/components/ui/num";
import {
  ActionSheet,
  type ActionSheetItem,
} from "@/components/ui/action-sheet";
import { Spinner } from "@/components/ui/button";
import { HIT, PRESS, REVEAL } from "@/components/ui/interaction";
import { LONG_PRESS_TARGET, useLongPress } from "@/hooks/useLongPress";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { SFUClient } from "@/lib/sfu-client";

import { useChatStore } from "@/stores/chat-store";
import { useListenTogetherStore } from "@/stores/useListenTogetherStore";
import { useSoundSettingsStore } from "@/stores/useSoundSettingsStore";
import { getAuthAssetUrl } from "@/lib/platform";
import type { Server } from "@/lib/types";
import {
  DEFAULT_SOUNDBOARD_SOUNDS,
  MAX_SOUNDBOARD_UPLOAD_BYTES,
  getSoundboardServerKey,
  stopSoundboardPlayback,
  setSoundboardMasterVolume,
  getSoundboardMasterVolume,
  playSoundboardPlayback,
} from "@/lib/voice/soundboard";
import { describeListenTogetherError } from "@/lib/listen-together";
import {
  getSoundboardUploadUrl,
  normalizeSoundboardUploadUrl,
} from "@/lib/voice/soundboard-media";
import {
  toSoundboardCatalogSound,
  type SoundboardCatalogSound,
} from "@/lib/voice/soundboard-catalog";
import {
  createSoundboardPlaybackId,
  parseSoundboardPlaybackId,
} from "@/lib/voice/soundboard-playback-id";
import { useVoiceSoundboardStore } from "@/stores/useVoiceSoundboardStore";
import EmojiToken from "./EmojiToken";
import InlineEmojiText from "./InlineEmojiText";
import { HomeIcon } from "./HomeIcon";
import { UploadSoundModal, type UploadSoundData } from "./UploadSoundModal";
import { ListenTogetherPanel } from "./ListenTogetherPanel";

interface Props {
  open?: boolean;
  isClosing?: boolean;
  onClose: () => void;
  placement?: "top-start" | "top-end" | "bottom-start" | "bottom-end";
  markerRef?: React.RefObject<HTMLElement | null>;
  initialView?: SoundboardView;
  sfu: SFUClient | null;
  serverId?: string | null;
  channelId?: string | null;
  roomSlug?: string | null;
  voiceSessionId?: string | null;
  localUserId?: string | null;
  selectionMode?: boolean;
  compact?: boolean;
  onSelect?: (sound: SoundboardCatalogSound) => void;
  serverIds?: string[];
}

type SoundboardView = "soundboard" | "myinstants" | "radio" | "listenTogether";

interface RadioStation {
  stationuuid: string;
  name: string;
  url_resolved: string;
  favicon: string;
  tags: string;
  clickcount: number;
}

type CustomSound = SoundboardCatalogSound;
type SoundboardSoundType =
  | "myinstants"
  | "custom"
  | "default"
  | "radio"
  | "server";

interface DmSoundCandidate {
  id: string;
  soundType?: SoundboardSoundType;
  dataUrl?: string;
  mediaUrl?: string;
  serverId?: string;
  source_server_id?: string;
}

type PickerServer = Pick<Server, "id" | "name" | "icon_url">;

function PickerServerIcon({
  server,
  small = false,
}: {
  server: PickerServer;
  small?: boolean;
}) {
  const iconClassName = small ? "size-4" : "size-6";
  if (server.icon_url) {
    return (
      <img
        src={getAuthAssetUrl(server.icon_url)}
        alt=""
        className={cn(
          iconClassName,
          "rounded-avatar object-cover outline-1 -outline-offset-1 outline-line",
        )}
      />
    );
  }

  return (
    <span
      className={cn(
        iconClassName,
        "flex items-center justify-center rounded-avatar bg-tint-3 font-display text-[11px] font-extrabold text-ink-1",
      )}
    >
      {server.name.slice(0, 1).toUpperCase()}
    </span>
  );
}

interface ServerSoundboardItem {
  id: string;
  name: string;
  file_url: string;
  emoji?: string;
  volume?: number;
  server_id?: string;
}

interface MyInstantsSound {
  id: string;
  title: string;
  url: string;
  color: string;
  emoji?: string;
  soundType?: SoundboardSoundType;
  serverId?: string;
  source_server_id?: string;
}

function normalizeFavoriteSound(sound: MyInstantsSound): MyInstantsSound {
  const sourceServerId = sound.source_server_id ?? sound.serverId;
  const isServerMedia =
    !!sourceServerId &&
    normalizeSoundboardUploadUrl(sound.url) ===
      getSoundboardUploadUrl(sound.id);

  return {
    ...sound,
    soundType: isServerMedia ? "server" : (sound.soundType ?? "myinstants"),
    ...(sourceServerId
      ? { serverId: sourceServerId, source_server_id: sourceServerId }
      : {}),
  };
}

function isDmSoundSourceValid(sound: DmSoundCandidate): boolean {
  if (sound.soundType === "default") {
    return (
      DEFAULT_SOUNDBOARD_SOUNDS.some((entry) => entry.id === sound.id) &&
      !sound.dataUrl &&
      !sound.mediaUrl
    );
  }

  return (
    sound.soundType === "server" &&
    !!(sound.source_server_id ?? sound.serverId) &&
    !sound.dataUrl &&
    normalizeSoundboardUploadUrl(sound.mediaUrl) ===
      getSoundboardUploadUrl(sound.id)
  );
}

interface SoundboardCatalogUpdatedEvent {
  server_key?: string;
  type?: string;
  sound?: {
    id?: string;
    name?: string;
    file_url?: string;
    emoji?: string;
    volume?: number;
  };
}

/** A synthetic event for handlers that only stop propagation. */
const SHEET_EVENT = {
  stopPropagation: () => {},
} as unknown as React.MouseEvent;

const FAVORITES_SECTION_ID = "favorites";
const CUSTOM_SECTION_ID = "custom-sounds";
const DEFAULT_SECTION_ID = "default-sounds";
const MAX_LOCAL_SOUNDBOARD_DATA_URL_BYTES = 128 * 1024;

function isSoundboardAudioFile(file: File) {
  if (file.type.startsWith("audio/")) return true;
  return /\.(aac|flac|m4a|mp3|oga|ogg|opus|wav|weba)$/i.test(file.name);
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("Failed to read file"));
    };
    reader.onerror = () =>
      reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

function readStoredSounds(key: string): CustomSound[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(key) || "[]");
  } catch {
    return [];
  }
}

function writeStoredSounds(key: string, sounds: CustomSound[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(key, JSON.stringify(sounds));
}

/** A tile's corner chip (preview, favourite, edit, delete): concentric with the 8px tile at a 4px inset. */
const TILE_ACTION = cn(
  "flex size-6 items-center justify-center rounded-xs bg-ply-3 text-ink-2 shadow-float outline-none pointer-fine:hover:text-ink-1 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus",
  PRESS,
  HIT,
);

type TileAction = {
  key: string;
  label: string;
  tooltip?: string;
  icon: IconName;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  className?: string;
};

function TileActionButton({ action }: { action: TileAction }) {
  const button = (
    <button
      type="button"
      aria-label={action.label}
      className={cn(TILE_ACTION, action.className)}
      onClick={action.onClick}
    >
      <Icon name={action.icon} size="xs" />
    </button>
  );
  if (!action.tooltip) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="right">{action.tooltip}</TooltipContent>
    </Tooltip>
  );
}

/**
 * One sound cell for every source (server, custom, default, MyInstants,
 * radio): the same tint-1 cell with a 24px glyph and the name in
 * text-ui-sm, so a favourites row never mixes colour tiles and black tiles.
 * The whole cell plays; the ring marks keyboard focus. Corner chips sit
 * inside the radius. A sound that is playing in the room shows the talk LED,
 * not a loop.
 */
function SoundTile({
  name,
  glyph,
  playLabel,
  onPlay,
  playing = false,
  actions,
  favorite,
  className,
  ...rootProps
}: {
  name: string;
  glyph: React.ReactNode;
  playLabel: string;
  onPlay: () => void;
  playing?: boolean;
  /** Hover-revealed chips on the top-left (preview, edit, delete). */
  actions: TileAction[];
  favorite?: {
    active: boolean;
    onToggle: (event: React.MouseEvent<HTMLButtonElement>) => void;
  };
  className?: string;
} & Omit<React.HTMLAttributes<HTMLDivElement>, "children">) {
  return (
    <div
      className={cn(
        "group relative flex aspect-square flex-col items-center justify-center gap-1 overflow-hidden rounded-md bg-tint-1 px-1.5 text-center transition-[background-color] duration-(--dur-1) ease-out pointer-fine:hover:bg-tint-2",
        className,
      )}
      {...rootProps}
    >
      <button
        type="button"
        data-picker-cell=""
        className={cn(
          "absolute inset-0 z-0 h-full w-full cursor-pointer rounded-md active:bg-tint-1",
          PICKER_RING,
        )}
        aria-label={playLabel}
        onClick={onPlay}
      />
      <span className="pointer-events-none z-10 flex size-6 items-center justify-center text-ink-3">
        {glyph}
      </span>
      <span className="pointer-events-none z-10 line-clamp-2 w-full text-ui-sm font-medium text-ink-1 [overflow-wrap:anywhere]">
        {name}
      </span>
      {playing ? (
        <Led
          state="talk"
          label="Playing"
          className="pointer-events-none absolute bottom-1.5 left-1.5 z-10"
        />
      ) : null}

      {actions.length > 0 ? (
        <div
          className={cn(
            "absolute left-1 top-1 z-20 flex flex-col gap-0.5",
            REVEAL,
          )}
        >
          {actions.map((action) => (
            <TileActionButton key={action.key} action={action} />
          ))}
        </div>
      ) : null}

      {favorite ? (
        <div className="absolute right-1 top-1 z-20">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={
                  favorite.active ? "Remove from favorites" : "Add to favorites"
                }
                className={cn(TILE_ACTION, !favorite.active && REVEAL)}
                onClick={favorite.onToggle}
              >
                <Icon
                  name="star"
                  state={favorite.active ? "active" : "idle"}
                  size="xs"
                  className={favorite.active ? "text-accent-ink" : undefined}
                />
              </button>
            </TooltipTrigger>
            <TooltipContent side="left">
              {favorite.active ? "Unfavorite" : "Favorite"}
            </TooltipContent>
          </Tooltip>
        </div>
      ) : null}
    </div>
  );
}

/** A sound's glyph: its emoji, or the generic sound mark. */
function SoundGlyph({ emoji }: { emoji?: string }) {
  return emoji ? (
    <EmojiToken
      value={emoji}
      className="block size-6 object-contain"
      fallbackClassName="block text-ui-xl leading-none"
    />
  ) : (
    <Icon name="soundboard" size="lg" />
  );
}

/** A station's favicon at glyph size, falling back to the sound mark. */
function StationGlyph({ favicon }: { favicon?: string }) {
  const [failed, setFailed] = useState(false);
  if (!favicon || failed) return <Icon name="soundboard" size="lg" />;
  return (
    <img
      src={favicon}
      alt=""
      onError={() => setFailed(true)}
      className="size-6 rounded-xs object-cover"
    />
  );
}

const SOUND_GRID = "grid grid-cols-4 gap-0.5";

function RailButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={active}
          onClick={onClick}
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-md outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus",
            PRESS,
            HIT,
            active
              ? "bg-tint-2 text-ink-1"
              : "text-ink-3 pointer-fine:hover:text-ink-1",
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

export default function SoundboardPicker({
  open,
  isClosing,
  onClose,
  placement = "top-start",
  markerRef,
  initialView = "soundboard",
  sfu,
  serverId,
  channelId,
  roomSlug,
  voiceSessionId,
  localUserId,
  selectionMode = false,
  compact = false,
  onSelect,
  serverIds = [],
}: Props) {
  const mounted = useMounted();
  const serverKey = getSoundboardServerKey(serverId);
  const storageKey = `voice-soundboard:${serverKey}`;
  const isServerSoundboard = !!serverId && serverId !== "@me";
  const isDirectMessageScope =
    !selectionMode && serverKey === "dm-call" && !isServerSoundboard;
  const pickerInitialView =
    selectionMode ||
    (isDirectMessageScope &&
      (initialView === "myinstants" || initialView === "radio"))
      ? "soundboard"
      : initialView;

  const [activeView, setActiveView] =
    useState<SoundboardView>(pickerInitialView);
  const previousInitialViewRef = useRef(initialView);
  const previousSelectionModeRef = useRef(selectionMode);
  if (
    previousInitialViewRef.current !== initialView ||
    previousSelectionModeRef.current !== selectionMode
  ) {
    previousInitialViewRef.current = initialView;
    previousSelectionModeRef.current = selectionMode;
    setActiveView(pickerInitialView);
  }
  const [dynamicStyle, setDynamicStyle] = useState<React.CSSProperties>({
    opacity: 0,
  });
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim());

  const [customSounds, setCustomSounds] = useState<CustomSound[]>(() =>
    isServerSoundboard || isDirectMessageScope
      ? []
      : readStoredSounds(storageKey),
  );
  const previousCustomSoundsContextRef = useRef({
    isServerSoundboard,
    storageKey,
  });
  if (
    previousCustomSoundsContextRef.current.isServerSoundboard !==
      isServerSoundboard ||
    previousCustomSoundsContextRef.current.storageKey !== storageKey
  ) {
    previousCustomSoundsContextRef.current = {
      isServerSoundboard,
      storageKey,
    };
    setCustomSounds(
      isServerSoundboard || isDirectMessageScope
        ? []
        : readStoredSounds(storageKey),
    );
  }
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [renderedEditingSound, setRenderedEditingSound] =
    useState<CustomSound | null>(null);
  const [soundToDelete, setSoundToDelete] = useState<CustomSound | null>(null);
  // Kept after close so the confirm can animate out with its content.
  const [renderedSoundToDelete, setRenderedSoundToDelete] =
    useState<CustomSound | null>(null);
  const deleteTriggerRef = useRef<HTMLButtonElement | null>(null);
  const previousSoundToDeleteRef = useRef<CustomSound | null>(null);

  useEffect(() => {
    if (previousSoundToDeleteRef.current && !soundToDelete) {
      deleteTriggerRef.current?.focus();
    }
    previousSoundToDeleteRef.current = soundToDelete;
  }, [soundToDelete]);
  const [sendVolume, setSendVolume] = useState(0.8);
  const storedSoundboardVolume = useSoundSettingsStore((state) =>
    localUserId ? state.getSettings(localUserId).soundboardVolume : null,
  );
  const updateSoundSettings = useSoundSettingsStore(
    (state) => state.updateSettings,
  );
  const volumePersistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const pendingVolumeRef = useRef<number | null>(null);
  const scheduleVolumePersistence = useCallback(
    (volume: number) => {
      pendingVolumeRef.current = Math.round(volume * 100);
      if (volumePersistTimerRef.current) {
        clearTimeout(volumePersistTimerRef.current);
      }
      volumePersistTimerRef.current = setTimeout(() => {
        volumePersistTimerRef.current = null;
        const pendingVolume = pendingVolumeRef.current;
        pendingVolumeRef.current = null;
        if (localUserId && pendingVolume !== null) {
          updateSoundSettings({ soundboardVolume: pendingVolume }, localUserId);
        }
      }, 250);
    },
    [localUserId, updateSoundSettings],
  );
  useEffect(
    () => () => {
      if (volumePersistTimerRef.current) {
        clearTimeout(volumePersistTimerRef.current);
      }
      const pendingVolume = pendingVolumeRef.current;
      if (localUserId && pendingVolume !== null) {
        updateSoundSettings({ soundboardVolume: pendingVolume }, localUserId);
      }
    },
    [localUserId, updateSoundSettings],
  );
  const [playbackVolume, setPlaybackVolume] = useState(() =>
    storedSoundboardVolume === null
      ? getSoundboardMasterVolume()
      : storedSoundboardVolume / 100,
  );

  const [activeCategory, setActiveCategory] = useState<string>(
    selectionMode ? CUSTOM_SECTION_ID : FAVORITES_SECTION_ID,
  );
  const pendingJumpIdRef = useRef<string | null>(null);

  const [myInstantsQuery, setMyInstantsQuery] = useState("");
  const [myInstantsResults, setMyInstantsResults] = useState<MyInstantsSound[]>(
    [],
  );
  const [isSearchingMyInstants, setIsSearchingMyInstants] = useState(false);
  const [myInstantsFavorites, setMyInstantsFavorites] = useState<
    MyInstantsSound[]
  >([]);
  const hasFetchedFavoritesRef = useRef(false);

  const [radioQuery, setRadioQuery] = useState("");
  const [radioResults, setRadioResults] = useState<RadioStation[]>([]);
  const [isSearchingRadio, setIsSearchingRadio] = useState(false);
  const roomError = useListenTogetherStore((state) =>
    roomSlug ? (state.rooms[roomSlug]?.roomError ?? null) : null,
  );
  const clearRoomError = useListenTogetherStore(
    (state) => state.clearRoomError,
  );

  const searchInputRef = useRef<HTMLInputElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const memberServers = useChatStore((state) => state.servers);
  const catalogServerIds = selectionMode
    ? serverIds
    : isServerSoundboard
      ? [serverId]
      : memberServers.map((server) => server.id);
  const pickerServers: PickerServer[] = catalogServerIds.map((id) => {
    const server = memberServers.find((entry) => entry.id === id);
    return server
      ? {
          id: server.id,
          name: server.name,
          icon_url: server.icon_url,
        }
      : { id, name: id, icon_url: null };
  });
  const serverSectionIds = pickerServers.map((server) => `server:${server.id}`);
  const catalogServerKey = catalogServerIds.join(",");
  const [serverSounds, setServerSounds] = useState<CustomSound[]>([]);
  const previousCatalogServerKeyRef = useRef(catalogServerKey);
  if (previousCatalogServerKeyRef.current !== catalogServerKey) {
    previousCatalogServerKeyRef.current = catalogServerKey;
    setServerSounds([]);
  }

  // Sounds playing in this room right now (anyone's), as a stable key so the
  // picker re-renders only when a playback starts or stops.
  const playingSoundKey = useVoiceSoundboardStore((state) => {
    const ids: string[] = [];
    for (const playback of Object.values(state.activePlaybacks)) {
      if (playback.paused || playback.serverKey !== serverKey) continue;
      const parsed = parseSoundboardPlaybackId(playback.playbackId);
      if (parsed) ids.push(parsed.soundId);
    }
    return ids.sort().join("|");
  });
  const playingSoundIds = useMemo(
    () => new Set(playingSoundKey ? playingSoundKey.split("|") : []),
    [playingSoundKey],
  );

  useEffect(() => {
    setSoundboardMasterVolume(playbackVolume);
  }, [playbackVolume]);

  useEffect(() => {
    if (storedSoundboardVolume === null) return;
    const nextVolume = storedSoundboardVolume / 100;
    setPlaybackVolume(nextVolume);
    setSoundboardMasterVolume(nextVolume);
  }, [storedSoundboardVolume]);

  useEffect(() => {
    if (
      selectionMode ||
      (activeView !== "soundboard" && activeView !== "myinstants")
    )
      return;
    if (hasFetchedFavoritesRef.current) return;
    hasFetchedFavoritesRef.current = true;
    apiGet<{ favorites: MyInstantsSound[] }>("/api/myinstants/favorites")
      .then((res) => {
        const loaded = res.favorites || [];
        const normalized = loaded.map(normalizeFavoriteSound);
        setMyInstantsFavorites(normalized);
      })
      .catch((err) =>
        console.error("Failed to load MyInstants favorites", err),
      );
  }, [activeView, selectionMode]);

  const toggleFavorite = async (
    sound: {
      id: string;
      name?: string;
      title?: string;
      mediaUrl?: string;
      dataUrl?: string;
      url?: string;
      color?: string;
      emoji?: string;
      soundType?: "myinstants" | "custom" | "default" | "radio" | "server";
      serverId?: string;
      source_server_id?: string;
      source?: "default" | "server" | "custom";
    },
    e: React.MouseEvent,
  ) => {
    e.stopPropagation();

    let derivedType = sound.soundType;
    if (!derivedType) {
      if (sound.color) derivedType = "myinstants";
      else if (
        sound.source === "server" ||
        sound.serverId ||
        sound.source_server_id
      )
        derivedType = "server";
      else if (
        sound.emoji ||
        sound.mediaUrl?.includes("blob:") ||
        sound.dataUrl
      )
        derivedType = "custom";
      else derivedType = "default";
    }

    const normalizedSound: MyInstantsSound = {
      id: sound.id,
      title: sound.title || sound.name || "Unknown sound",
      url: sound.url || sound.mediaUrl || sound.dataUrl || "",
      color: sound.color || "#4f46e5",
      emoji: sound.emoji,
      soundType: derivedType,
      ...(sound.serverId || sound.source_server_id
        ? { serverId: sound.serverId ?? sound.source_server_id }
        : {}),
      ...(sound.serverId || sound.source_server_id
        ? { source_server_id: sound.source_server_id ?? sound.serverId }
        : {}),
    };

    const isFav = myInstantsFavorites.some((s) => s.id === sound.id);
    setMyInstantsFavorites((prev) =>
      isFav
        ? prev.filter((s) => s.id !== sound.id)
        : [normalizedSound, ...prev],
    );
    try {
      await apiPost("/api/myinstants/favorites", {
        action: isFav ? "remove" : "add",
        sound: normalizedSound,
      });
    } catch (err) {
      console.error("Failed to toggle favorite", err);
      setMyInstantsFavorites((prev) =>
        isFav
          ? [normalizedSound, ...prev]
          : prev.filter((s) => s.id !== sound.id),
      );
    }
  };

  useEffect(() => {
    if (activeView !== "soundboard" || !catalogServerKey) {
      return;
    }
    const controller = new AbortController();
    void Promise.allSettled(
      catalogServerKey.split(",").map((catalogId) =>
        apiGet<ServerSoundboardItem[]>(`/api/servers/${catalogId}/soundboard`, {
          signal: controller.signal,
        }).then((sounds) =>
          sounds.map((sound) =>
            toSoundboardCatalogSound(
              {
                id: sound.id,
                name: sound.name,
                mediaUrl: sound.file_url,
                emoji: sound.emoji,
                volume: sound.volume,
                serverId: sound.server_id ?? catalogId,
              },
              "server",
            ),
          ),
        ),
      ),
    ).then((results) => {
      if (controller.signal.aborted) return;
      const sounds = results.flatMap((result) =>
        result.status === "fulfilled" ? result.value : [],
      );
      setServerSounds(sounds.flat());
      for (const result of results) {
        if (result.status === "rejected") {
          console.error("Failed to load a server soundboard:", result.reason);
        }
      }
    });
    return () => controller.abort();
  }, [activeView, catalogServerKey, isServerSoundboard, serverId]);

  // `sfu.on(...)` returns the unsubscribe function from EventEmitter.on.
  // react-doctor-disable-next-line react-doctor/effect-needs-cleanup
  useEffect(() => {
    if (!sfu || !isServerSoundboard) return;
    return sfu.on("app-event", (event) => {
      const payload = event as SoundboardCatalogUpdatedEvent;
      if (
        payload.server_key !== serverKey ||
        payload.type !== "soundboard.catalog-updated"
      )
        return;
      const sound = payload.sound;
      if (
        !sound ||
        typeof sound.id !== "string" ||
        typeof sound.name !== "string"
      ) {
        return;
      }
      const soundId = sound.id;
      const soundName = sound.name;
      setServerSounds((prev) => {
        const existing = prev.find((entry) => entry.id === soundId);
        if (!existing && typeof sound.file_url !== "string") return prev;
        const nextSound: CustomSound = {
          ...(existing ?? {}),
          id: soundId,
          name: soundName,
          serverId: serverId ?? undefined,
          ...(typeof sound.file_url === "string"
            ? { mediaUrl: sound.file_url }
            : {}),
          ...(typeof sound.emoji === "string" ? { emoji: sound.emoji } : {}),
          ...(typeof sound.volume === "number" ? { volume: sound.volume } : {}),
        };
        return [
          nextSound,
          ...prev.filter((entry) => entry.id !== nextSound.id),
        ];
      });
    });
  }, [isServerSoundboard, sfu, serverId, serverKey]);

  useEffect(() => {
    if (selectionMode || activeView !== "myinstants") return;
    const fetchMyInstants = () => {
      const controller = new AbortController();
      setIsSearchingMyInstants(true);
      const queryParams = new URLSearchParams();
      if (myInstantsQuery.trim()) queryParams.set("q", myInstantsQuery.trim());
      apiGet<{ results: MyInstantsSound[] }>(
        `/api/myinstants?${queryParams.toString()}`,
        { signal: controller.signal },
      )
        .then((res) => setMyInstantsResults(res.results || []))
        .catch((err) => {
          if (!controller.signal.aborted)
            console.error("MyInstants search error", err);
        })
        .finally(() => setIsSearchingMyInstants(false));
      return controller;
    };
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    let controller: AbortController | undefined;
    searchTimeoutRef.current = setTimeout(
      () => {
        controller = fetchMyInstants();
      },
      myInstantsQuery.trim() ? 400 : 0,
    );
    return () => {
      controller?.abort();
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, [activeView, myInstantsQuery, selectionMode]);

  useEffect(() => {
    if (selectionMode || activeView !== "radio") return;
    const fetchRadio = () => {
      const controller = new AbortController();
      setIsSearchingRadio(true);
      let url =
        "https://de1.api.radio-browser.info/json/stations/topclick/25?hidebroken=true";
      if (radioQuery.trim()) {
        const q = encodeURIComponent(radioQuery.trim());
        url = `https://de1.api.radio-browser.info/json/stations/search?name=${q}&limit=25&hidebroken=true&order=clickcount&reverse=true`;
      }
      fetch(url, {
        signal: controller.signal,
        headers: { "User-Agent": "RalphMeet/1.0" },
      })
        .then((res) => {
          if (res.ok === false) {
            throw new Error(`Radio browser request failed (${res.status}).`);
          }
          return res.json();
        })
        .then((data) => setRadioResults(Array.isArray(data) ? data : []))
        .catch((err) => {
          if (!controller.signal.aborted) {
            setRadioResults([]);
            console.error("Radio search error", err);
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setIsSearchingRadio(false);
        });
      return controller;
    };

    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    let controller: AbortController | undefined;
    searchTimeoutRef.current = setTimeout(
      () => {
        controller = fetchRadio();
      },
      radioQuery.trim() ? 400 : 0,
    );
    return () => {
      controller?.abort();
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, [activeView, radioQuery, selectionMode]);

  useEffect(() => {
    searchInputRef.current?.focus();
  }, [activeView]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (isUploadModalOpen) return;
      if (
        activeView === "listenTogether" &&
        event.target instanceof HTMLInputElement &&
        event.target.type === "range"
      ) {
        event.preventDefault();
        return;
      }
      // The delete confirm is the top layer: it closes on its own Escape.
      if (soundToDelete) return;
      onClose();
    };
    window.addEventListener("keydown", handleEscape, { capture: true });
    return () =>
      window.removeEventListener("keydown", handleEscape, { capture: true });
  }, [activeView, isUploadModalOpen, onClose, soundToDelete]);

  useEffect(() => {
    const pendingJumpId = pendingJumpIdRef.current;
    if (!pendingJumpId || activeView !== "soundboard" || deferredSearch) return;
    const container = contentRef.current;
    const node = sectionRefs.current[pendingJumpId];
    if (!container || !node) return;
    const frame = window.requestAnimationFrame(() => {
      container.scrollTo({ top: Math.max(0, node.offsetTop) });
      pendingJumpIdRef.current = null;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeView, deferredSearch]);

  const setSectionRef = useCallback(
    (id: string) => (node: HTMLDivElement | null) => {
      sectionRefs.current[id] = node;
    },
    [],
  );

  const jumpToSection = useCallback((id: string) => {
    setActiveView("soundboard");
    setSearch("");
    setActiveCategory(id);
    pendingJumpIdRef.current = id;
  }, []);

  const handleListScroll = useCallback(() => {
    if (deferredSearch) return;
    const container = contentRef.current;
    if (!container) return;
    let nextActive = activeCategory;
    const scrollTop = container.scrollTop;
    const sections = [
      FAVORITES_SECTION_ID,
      ...serverSectionIds,
      CUSTOM_SECTION_ID,
      DEFAULT_SECTION_ID,
    ];
    for (const id of sections) {
      const node = sectionRefs.current[id];
      if (!node) continue;
      if (node.offsetTop - 32 <= scrollTop) {
        nextActive = id;
      }
    }
    if (nextActive !== activeCategory) {
      setActiveCategory(nextActive);
    }
  }, [activeCategory, deferredSearch, serverSectionIds]);

  const persistLocalSounds = (next: CustomSound[]) => {
    setCustomSounds(next);
    writeStoredSounds(storageKey, next);
  };

  useEffect(() => {
    const updatePosition = () => {
      if (!markerRef?.current) {
        setDynamicStyle({ opacity: 1 });
        return;
      }

      // Phones render a drawer; positioning is desktop-only.
      if (isMobileViewport()) {
        setDynamicStyle({ opacity: 1 });
        return;
      }

      const rect = markerRef.current.getBoundingClientRect();
      const pickerWidth = Math.min(
        window.innerWidth - 24,
        activeView === "listenTogether" ? 980 : PICKER_WIDTH,
      );

      // The picker recipe caps at 600; Listen Together is a wider workbench.
      const MAX_HEIGHT = Math.min(
        compact ? 560 : activeView === "listenTogether" ? 820 : 600,
        window.innerHeight - 24,
      );

      const style: React.CSSProperties = {
        opacity: 1,
        width: pickerWidth,
        maxHeight: MAX_HEIGHT,
        height: MAX_HEIGHT,
      };

      if (compact) {
        let left = rect.left - pickerWidth - 10;
        if (left < 12) left = rect.right + 10;
        if (left + pickerWidth > window.innerWidth - 12) {
          left = Math.max(12, window.innerWidth - pickerWidth - 12);
        }
        const top = Math.min(
          Math.max(12, rect.top),
          Math.max(12, window.innerHeight - MAX_HEIGHT - 12),
        );
        setDynamicStyle({ ...style, left, top });
        return;
      }

      let left = rect.left;
      if (left + pickerWidth > window.innerWidth - 10) {
        left = Math.max(10, window.innerWidth - pickerWidth - 10);
      }
      if (left < 10) left = 10;
      style.left = left;

      if (placement.startsWith("bottom")) {
        if (rect.bottom + 8 + MAX_HEIGHT > window.innerHeight - 10) {
          style.bottom = 10;
        } else {
          style.top = rect.bottom + 8;
        }
      } else {
        style.bottom = window.innerHeight - rect.top + 8;
        style.maxHeight = Math.min(MAX_HEIGHT, Math.max(100, rect.top - 16));
      }

      setDynamicStyle(style);
    };

    const frameId = window.requestAnimationFrame(updatePosition);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.cancelAnimationFrame(frameId);
    };
  }, [activeView, compact, markerRef, placement]);

  const isDmPlayableSound = (sound: DmSoundCandidate) => {
    if (!isDmSoundSourceValid(sound)) return false;
    if (sound.soundType === "default") return true;
    const sourceServerId = sound.source_server_id ?? sound.serverId;
    return (
      !!sourceServerId &&
      serverSounds.some(
        (serverSound) =>
          serverSound.id === sound.id &&
          serverSound.serverId === sourceServerId &&
          normalizeSoundboardUploadUrl(serverSound.mediaUrl) ===
            getSoundboardUploadUrl(sound.id),
      )
    );
  };

  const broadcastSound = (sound: {
    id: string;
    name: string;
    dataUrl?: string;
    mediaUrl?: string;
    volume?: number;
    emoji?: string;
    soundType?: SoundboardSoundType;
    artworkUrl?: string;
    serverId?: string;
    source_server_id?: string;
    source?: "default" | "server" | "custom";
  }) => {
    if (selectionMode) {
      const source =
        sound.soundType === "default"
          ? "default"
          : isServerSoundboard || sound.serverId
            ? "server"
            : "custom";
      if (source === "custom") return;
      onSelect?.(
        toSoundboardCatalogSound(
          {
            id: sound.id,
            name: sound.name,
            dataUrl: sound.dataUrl,
            mediaUrl: sound.mediaUrl,
            emoji: sound.emoji,
            volume: sound.volume,
            serverId:
              source === "server"
                ? (sound.serverId ?? serverId ?? undefined)
                : undefined,
          },
          source,
        ),
      );
      return;
    }
    const sourceServerId = sound.serverId ?? sound.source_server_id;
    if (isDirectMessageScope && !isDmPlayableSound(sound)) {
      setUploadError(
        "Only default and member-server sounds are available in DMs.",
      );
      return;
    }

    // Radio stations are enqueued to Listen Together instead of soundboard.play
    if (sound.soundType === "radio") {
      if (!roomSlug || !sfu) {
        setUploadError("Connect to the voice room before playing radio.");
        return;
      }
      const currentUser = useChatStore.getState().user;
      const requester = {
        userId: localUserId || currentUser?.id || "guest",
        displayName:
          currentUser?.display_name?.trim() || currentUser?.username || "You",
        avatarUrl: currentUser?.avatar_url ?? null,
        avatarDisplay: currentUser?.avatar_display ?? null,
      };

      const accepted = sfu.voiceGW.sendAppEvent({
        type: "listen_together.enqueue",
        room_slug: roomSlug,
        mode: "append",
        entries: [
          {
            track: {
              kind: "radio",
              station_uuid: sound.id,
              provider: "radio",
              title: sound.name,
            },
            requester,
          },
        ],
      });
      if (accepted === false) {
        setUploadError("Could not enqueue the radio station.");
      } else {
        setUploadError(null);
        clearRoomError(roomSlug);
      }
      return;
    }

    // Generate a deterministic playback ID so that playing the same sound
    // again by the same user automatically cancels their previous stream
    // locally for all clients and updates the same UI entry in the store.
    if (!localUserId) return;
    const playbackId = createSoundboardPlaybackId(localUserId, sound.id);

    const source = sound.mediaUrl
      ? { media_url: sound.mediaUrl }
      : sound.dataUrl
        ? { data_url: sound.dataUrl }
        : {};
    if (sound.soundType === "server" && !sourceServerId) {
      setUploadError("This server favorite is missing its source server.");
      return;
    }
    if (isServerSoundboard && sourceServerId && sourceServerId !== serverId) {
      setUploadError(
        "This server sound is not available in the current voice server.",
      );
      return;
    }
    const dmSourceServer =
      serverKey === "dm-call" && sourceServerId
        ? { source_server_id: sourceServerId }
        : {};
    const accepted = sfu?.voiceGW.sendAppEvent({
      type: "soundboard.play",
      server_key: serverKey,
      user_id: localUserId,
      playback_id: playbackId,
      sound_id: sound.id,
      name: sound.name,
      ...source,
      ...dmSourceServer,
      volume: sendVolume * (sound.volume ?? 1.0),
    });
    if (accepted === false) setUploadError("Could not play this sound.");
  };

  const previewSound = (
    sound: {
      id: string;
      name: string;
      dataUrl?: string;
      mediaUrl?: string;
      volume?: number;
      emoji?: string;
      soundType?: SoundboardSoundType;
      serverId?: string;
      source_server_id?: string;
    },
    e: React.MouseEvent,
  ) => {
    e.stopPropagation();
    if (
      isDirectMessageScope &&
      !isDmPlayableSound({
        id: sound.id,
        soundType: sound.soundType,
        dataUrl: sound.dataUrl,
        mediaUrl: sound.mediaUrl,
        serverId: sound.serverId,
        source_server_id: sound.source_server_id,
      })
    ) {
      setUploadError(
        "Only default and member-server sounds are available in DMs.",
      );
      return;
    }
    stopSoundboardPlayback("local-preview", serverKey);

    setTimeout(() => {
      playSoundboardPlayback({
        playbackId: "local-preview",
        ownerId: localUserId || "local",
        serverKey,
        name: `Preview: ${sound.name}`,
        soundId: sound.id,
        dataUrl: sound.dataUrl,
        mediaUrl: sound.mediaUrl,
        volume: sendVolume * (sound.volume ?? 1.0),
        isLocal: true,
        includeInVoiceActivity: false,
        receivedAt: Date.now(),
      });
    }, 0);
  };

  const handleDeleteSound = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (isServerSoundboard && serverId) {
      try {
        await apiDelete(`/api/servers/${serverId}/soundboard?soundId=${id}`);
        setServerSounds((prev) => prev.filter((s) => s.id !== id));
      } catch (err) {
        console.error("Failed to delete server sound", err);
        setUploadError("Failed to delete sound. You may not have permission.");
      }
    } else {
      persistLocalSounds(customSounds.filter((s) => s.id !== id));
    }
  };

  const handleUpload = async (data: UploadSoundData) => {
    setUploadError(null);
    setIsUploading(true);
    const { file, soundId, soundName, relatedEmoji, soundVolume } = data;
    try {
      if (soundId) {
        // Edit mode
        if (!isServerSoundboard) {
          const updatedSounds = customSounds.map((s) =>
            s.id === soundId
              ? {
                  ...s,
                  name: soundName,
                  emoji: relatedEmoji || undefined,
                  volume: soundVolume,
                }
              : s,
          );
          persistLocalSounds(updatedSounds);
          setIsUploadModalOpen(false);
          return;
        }

        if (!channelId)
          throw new Error("Join a voice channel to edit server sounds.");
        await apiPatch(
          `/api/servers/${serverId}/soundboard?soundId=${soundId}`,
          {
            sound_name: soundName,
            sound_emoji: relatedEmoji,
            sound_volume: soundVolume,
          },
        );

        setServerSounds((prev) =>
          prev.map((s) =>
            s.id === soundId
              ? {
                  ...s,
                  name: soundName,
                  emoji: relatedEmoji || undefined,
                  volume: soundVolume,
                }
              : s,
          ),
        );
        setIsUploadModalOpen(false);
        sfu?.voiceGW.sendAppEvent({
          type: "soundboard.catalog-updated",
          server_key: serverKey,
          user_id: localUserId,
          sound: {
            id: soundId,
            name: soundName,
            emoji: relatedEmoji || undefined,
            volume: soundVolume,
          },
        });
        return;
      }

      if (!file) {
        throw new Error("A file is required to upload a new sound.");
      }
      if (!isSoundboardAudioFile(file)) {
        throw new Error("Only audio files can be uploaded to the soundboard.");
      }
      if (!isServerSoundboard) {
        if (file.size > MAX_LOCAL_SOUNDBOARD_DATA_URL_BYTES) {
          throw new Error(
            "Custom sounds must be 128 KiB or smaller to play for everyone.",
          );
        }
        const dataUrl = await fileToDataUrl(file);
        const nextSound = {
          id: crypto.randomUUID(),
          name: soundName,
          dataUrl,
          emoji: relatedEmoji || undefined,
          volume: soundVolume,
        };
        persistLocalSounds([nextSound, ...customSounds]);
        setIsUploadModalOpen(false);
        return;
      }
      if (!channelId) {
        throw new Error(
          "Join a voice channel before uploading soundboard audio.",
        );
      }
      if (file.size > MAX_SOUNDBOARD_UPLOAD_BYTES) {
        throw new Error("Soundboard uploads must be 50 MB or smaller.");
      }
      const formData = new FormData();
      formData.append("file", file);
      formData.append("purpose", "soundboard");
      formData.append("sound_name", soundName);
      if (relatedEmoji) formData.append("sound_emoji", relatedEmoji);
      formData.append("sound_volume", soundVolume.toString());
      const uploaded = await apiUpload<{
        id: string;
        file_url: string;
        file_name: string;
        file_size: number;
        content_type: string;
      }>(`/api/channels/${channelId}/messages/upload`, formData);
      const nextSound = {
        id: uploaded.id,
        name: soundName,
        mediaUrl: uploaded.file_url,
        emoji: relatedEmoji || undefined,
        volume: soundVolume,
        serverId: serverId ?? undefined,
      };
      setServerSounds((prev) => [
        nextSound,
        ...prev.filter((entry) => entry.id !== nextSound.id),
      ]);
      setIsUploadModalOpen(false);
      sfu?.voiceGW.sendAppEvent({
        type: "soundboard.catalog-updated",
        server_key: serverKey,
        user_id: localUserId,
        sound: {
          id: nextSound.id,
          name: nextSound.name,
          file_url: nextSound.mediaUrl,
          emoji: nextSound.emoji,
          volume: nextSound.volume,
        },
      });
    } catch (error) {
      setUploadError(describeApiError(error, "add that sound"));
    } finally {
      setIsUploading(false);
    }
  };

  const openEditModal = (sound: CustomSound, e: React.MouseEvent) => {
    e.stopPropagation();
    setRenderedEditingSound(sound);
    setIsUploadModalOpen(true);
  };

  // Touch: a long press on a sound tile opens its actions as a sheet, since
  // edit and delete don't fit on a phone-sized tile.
  const [tileSheet, setTileSheet] = useState<{
    title: string;
    items: ActionSheetItem[];
  } | null>(null);
  const bindTileLongPress = useLongPress<{
    sound: CustomSound;
    isFav: boolean;
  }>((_info, { sound, isFav }) => {
    const canManage =
      !selectionMode && (!sound.serverId || sound.serverId === serverId);
    setTileSheet({
      title: sound.name,
      items: [
        {
          key: "preview",
          label: "Preview",
          icon: <Icon name="play" size="lg" />,
          onClick: () =>
            previewSound({ ...sound, soundType: "server" }, SHEET_EVENT),
        },
        {
          key: "favorite",
          label: isFav ? "Remove from favorites" : "Add to favorites",
          icon: (
            <Icon name="star" state={isFav ? "active" : "idle"} size="lg" />
          ),
          onClick: () => void toggleFavorite(sound, SHEET_EVENT),
          divider: canManage,
        },
        ...(canManage
          ? [
              {
                key: "edit",
                label: "Edit sound",
                icon: <Icon name="edit" size="lg" />,
                onClick: () => openEditModal(sound, SHEET_EVENT),
              },
              {
                key: "delete",
                label: "Delete sound",
                icon: <Icon name="trash" size="lg" />,
                variant: "danger" as const,
                onClick: () => {
                  deleteTriggerRef.current = null;
                  setSoundToDelete(sound);
                  setRenderedSoundToDelete(sound);
                },
              },
            ]
          : []),
      ],
    });
  });

  const filteredFavorites = deferredSearch
    ? myInstantsFavorites.filter((s) =>
        s.title.toLowerCase().includes(deferredSearch.toLowerCase()),
      )
    : myInstantsFavorites;
  const visibleFavorites = isDirectMessageScope
    ? filteredFavorites.filter((sound) => {
        return isDmPlayableSound({ ...sound, mediaUrl: sound.url });
      })
    : filteredFavorites;
  const filteredCustom = deferredSearch
    ? customSounds.filter((s) =>
        s.name.toLowerCase().includes(deferredSearch.toLowerCase()),
      )
    : customSounds;
  const filteredServerSounds = deferredSearch
    ? serverSounds.filter((s) =>
        s.name.toLowerCase().includes(deferredSearch.toLowerCase()),
      )
    : serverSounds;
  const serverSoundSections = pickerServers.map((server) => ({
    id: `server:${server.id}`,
    server,
    sounds: filteredServerSounds.filter(
      (sound) => sound.serverId === server.id,
    ),
  }));
  const soundSections = [
    ...serverSoundSections,
    ...(!isServerSoundboard && !selectionMode && !isDirectMessageScope
      ? [{ id: CUSTOM_SECTION_ID, server: null, sounds: filteredCustom }]
      : []),
  ];
  const filteredDefault = deferredSearch
    ? DEFAULT_SOUNDBOARD_SOUNDS.filter((s) =>
        s.name.toLowerCase().includes(deferredSearch.toLowerCase()),
      )
    : DEFAULT_SOUNDBOARD_SOUNDS;

  const placementClasses =
    {
      "top-start": "bottom-[calc(100%+10px)] -left-2 origin-bottom-left",
      "top-end": "bottom-[calc(100%+10px)] right-0 origin-bottom-right",
      "bottom-start": "top-[calc(100%+10px)] -left-2 origin-top-left",
      "bottom-end": "top-[calc(100%+10px)] right-0 origin-top-right",
    }[placement] || "bottom-[calc(100%+10px)] right-0 origin-bottom-right";
  const isPickerOpen = open ?? !isClosing;
  const pickerPositionClasses = compact
    ? ""
    : selectionMode
      ? "inset-0 m-auto h-[min(600px,calc(100dvh-24px))]"
      : !markerRef
        ? placementClasses
        : "";

  if (!mounted) return null;

  const favoriteFor = (
    sound: Parameters<typeof toggleFavorite>[0],
    isFav: boolean,
  ) => ({
    active: isFav,
    onToggle: (event: React.MouseEvent<HTMLButtonElement>) =>
      void toggleFavorite(sound, event),
  });

  const renderFavoriteTile = (sound: MyInstantsSound) => {
    const isRadio = sound.soundType === "radio";
    const previewTarget = {
      id: sound.id,
      name: sound.title,
      mediaUrl: sound.url,
      soundType: sound.soundType,
      ...(isRadio
        ? {}
        : {
            serverId: sound.serverId ?? sound.source_server_id,
            source_server_id: sound.source_server_id,
          }),
    };
    return (
      <SoundTile
        key={`fav-${sound.id}`}
        name={sound.title}
        glyph={
          isRadio ? (
            <StationGlyph favicon={sound.emoji} />
          ) : sound.soundType === "default" ? (
            <Icon name="soundboard" size="lg" />
          ) : sound.soundType === "myinstants" ? (
            <Icon name="zap" size="lg" />
          ) : (
            <SoundGlyph emoji={sound.emoji} />
          )
        }
        playLabel={`Play ${sound.title}`}
        playing={playingSoundIds.has(sound.id)}
        onPlay={() =>
          broadcastSound(
            isRadio
              ? {
                  id: sound.id,
                  name: sound.title,
                  mediaUrl: sound.url,
                  soundType: "radio",
                  artworkUrl: sound.emoji,
                }
              : {
                  id: sound.id,
                  name: sound.title,
                  mediaUrl: sound.url,
                  soundType: sound.soundType,
                  serverId: sound.serverId ?? sound.source_server_id,
                  source_server_id: sound.source_server_id,
                },
          )
        }
        actions={[
          {
            key: "preview",
            label: isRadio ? "Preview station" : "Preview",
            tooltip: isRadio ? "Preview station" : "Preview",
            icon: "play",
            onClick: (event) => previewSound(previewTarget, event),
          },
        ]}
        favorite={favoriteFor(sound, true)}
      />
    );
  };

  return createPortal(
    <>
      <TooltipProvider>
        <PickerSurface
          open={isPickerOpen}
          modal={false}
          onOpenChange={(nextOpen) => {
            if (!nextOpen && !soundToDelete && !isUploadModalOpen) onClose();
          }}
          ariaLabel="Soundboard picker"
          contentRef={pickerRef}
          stacked={selectionMode}
          initialFocusRef={searchInputRef}
          anchorRef={markerRef}
          onEscapeKeyDown={(event) => {
            const target = event.target;
            if (
              soundToDelete ||
              (activeView === "listenTogether" &&
                target instanceof HTMLInputElement &&
                target.type === "range")
            ) {
              event.preventDefault();
            }
          }}
          className={cn(
            activeView === "listenTogether"
              ? "h-[min(820px,calc(100dvh-24px))] max-h-[min(820px,calc(100dvh-24px))] w-[min(980px,calc(100vw-24px))]"
              : PICKER_WIDTH_CLASS,
            pickerPositionClasses,
          )}
          style={markerRef ? dynamicStyle : undefined}
        >
          {activeView === "soundboard" ? (
            <PickerHeader>
              <PickerSearch
                ref={searchInputRef}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    contentRef.current
                      ?.querySelector<HTMLElement>("[data-picker-cell]")
                      ?.focus();
                  }
                }}
                aria-label="Search soundboard sounds"
                placeholder="Search soundboard"
              />
              {!selectionMode && !isDirectMessageScope && (
                <>
                  <IconButton
                    icon="headphones"
                    size={32}
                    onClick={() => setActiveView("listenTogether")}
                    aria-label="Listen Together"
                    tooltip="Listen Together"
                    tooltipSide="bottom"
                    className="pointer-coarse:size-11"
                  />
                  <IconButton
                    icon="soundboard"
                    size={32}
                    onClick={() => setActiveView("radio")}
                    aria-label="Search radio"
                    tooltip="Search radio"
                    tooltipSide="bottom"
                    className="pointer-coarse:size-11"
                  />
                  <IconButton
                    icon="zap"
                    size={32}
                    onClick={() => setActiveView("myinstants")}
                    aria-label="Search MyInstants"
                    tooltip="Search MyInstants"
                    tooltipSide="bottom"
                    className="pointer-coarse:size-11"
                  />
                </>
              )}
            </PickerHeader>
          ) : activeView === "listenTogether" ? (
            <PickerHeader>
              <IconButton
                icon="back"
                size={32}
                onClick={() => setActiveView("soundboard")}
                aria-label="Back"
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-ui-row font-semibold text-ink-1">
                  Listen Together
                </div>
                <div className="truncate text-ui-xs text-ink-3">
                  Synced room playback with a shared queue
                </div>
              </div>
            </PickerHeader>
          ) : (
            <PickerHeader>
              <IconButton
                icon="back"
                size={32}
                onClick={() => setActiveView("soundboard")}
                aria-label="Back"
              />
              <PickerSearch
                ref={searchInputRef}
                value={activeView === "radio" ? radioQuery : myInstantsQuery}
                onChange={(event) =>
                  activeView === "radio"
                    ? setRadioQuery(event.target.value)
                    : setMyInstantsQuery(event.target.value)
                }
                aria-label={
                  activeView === "radio"
                    ? "Search radio stations"
                    : "Search MyInstants sounds"
                }
                placeholder={
                  activeView === "radio"
                    ? "Search radio stations"
                    : "Search MyInstants"
                }
              />
            </PickerHeader>
          )}
          {(uploadError || (activeView === "radio" && roomError)) && (
            <div
              role="alert"
              className="mx-2 mt-2 shrink-0 rounded-md bg-danger-tint px-3 py-2 text-ui-xs text-danger-ink"
            >
              {activeView === "radio" && roomError
                ? describeListenTogetherError(roomError, "start the radio")
                : uploadError}
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-hidden">
            {activeView === "listenTogether" ? (
              <ListenTogetherPanel
                sfu={sfu}
                serverId={serverId}
                channelId={channelId}
                roomSlug={roomSlug}
                voiceSessionId={voiceSessionId}
                localUserId={localUserId}
              />
            ) : activeView === "soundboard" ? (
              <div className="flex h-full">
                <nav
                  aria-label="Sound collections"
                  className="no-scrollbar flex w-10 shrink-0 flex-col items-center gap-1 overflow-y-auto border-r border-line py-1"
                >
                  {!selectionMode && (
                    <>
                      <RailButton
                        label="Favorites"
                        active={activeCategory === FAVORITES_SECTION_ID}
                        onClick={() => jumpToSection(FAVORITES_SECTION_ID)}
                      >
                        <Icon
                          name="star"
                          state={
                            activeCategory === FAVORITES_SECTION_ID
                              ? "active"
                              : "idle"
                          }
                          size="lg"
                        />
                      </RailButton>
                      <div className="my-0.5 h-px w-5 shrink-0 bg-line" />
                    </>
                  )}

                  {pickerServers.map((server) => {
                    const sectionId = `server:${server.id}`;
                    return (
                      <Tooltip key={server.id}>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            aria-label={`Jump to ${server.name} server sounds`}
                            aria-pressed={activeCategory === sectionId}
                            onClick={() => jumpToSection(sectionId)}
                            className={cn(
                              "flex size-8 shrink-0 items-center justify-center rounded-md outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus",
                              PRESS,
                              HIT,
                              activeCategory === sectionId && "bg-tint-2",
                            )}
                          >
                            <PickerServerIcon server={server} />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="right" sideOffset={8}>
                          <InlineEmojiText text={server.name} />
                        </TooltipContent>
                      </Tooltip>
                    );
                  })}

                  {!selectionMode &&
                    !isServerSoundboard &&
                    !isDirectMessageScope && (
                      <RailButton
                        label="Custom sounds"
                        active={activeCategory === CUSTOM_SECTION_ID}
                        onClick={() => jumpToSection(CUSTOM_SECTION_ID)}
                      >
                        <Icon name="voiceChannel" size="lg" />
                      </RailButton>
                    )}

                  <RailButton
                    label="Ralph sounds"
                    active={activeCategory === DEFAULT_SECTION_ID}
                    onClick={() => jumpToSection(DEFAULT_SECTION_ID)}
                  >
                    <HomeIcon className="size-5" />
                  </RailButton>
                </nav>

                <main
                  ref={contentRef}
                  onScroll={handleListScroll}
                  onKeyDown={handlePickerGridKeyDown}
                  className="no-scrollbar relative min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-1 pb-1 max-md:overscroll-contain"
                >
                  {/* Favorites */}
                  {!selectionMode &&
                    (!deferredSearch || visibleFavorites.length > 0) && (
                      <section
                        ref={setSectionRef(FAVORITES_SECTION_ID)}
                        aria-label="Favorites"
                      >
                        <PickerSectionLabel>Favorites</PickerSectionLabel>
                        {visibleFavorites.length === 0 ? (
                          <div className="px-2 pb-3 pt-1 text-ui-xs text-ink-3">
                            {isDirectMessageScope
                              ? "No member-server favorites yet."
                              : "No favorites yet. Search MyInstants to add some!"}
                          </div>
                        ) : (
                          <div className={SOUND_GRID}>
                            {visibleFavorites.map(renderFavoriteTile)}
                          </div>
                        )}
                      </section>
                    )}

                  {/* Server and custom sound sections */}
                  {soundSections.map((section) => (
                    <section
                      key={section.id}
                      ref={setSectionRef(section.id)}
                      aria-label={section.server?.name ?? "Custom sounds"}
                    >
                      <PickerSectionLabel>
                        {section.server ? (
                          <span className="flex min-w-0 items-center gap-1.5">
                            <PickerServerIcon server={section.server} small />
                            <span className="truncate">
                              <InlineEmojiText text={section.server.name} />
                            </span>
                          </span>
                        ) : (
                          "Custom sounds"
                        )}
                      </PickerSectionLabel>
                      <div className={SOUND_GRID}>
                        {!deferredSearch &&
                          !selectionMode &&
                          (!section.server ||
                            section.server.id === serverId) && (
                            <button
                              type="button"
                              data-picker-cell=""
                              onClick={() => {
                                setRenderedEditingSound(null);
                                setIsUploadModalOpen(true);
                              }}
                              className={cn(
                                "flex aspect-square flex-col items-center justify-center gap-1 rounded-md border border-dashed border-line-strong px-1.5 text-ink-3 transition-[background-color,color] duration-(--dur-1) ease-out pointer-fine:hover:bg-tint-1 pointer-fine:hover:text-ink-1",
                                PICKER_RING,
                              )}
                            >
                              <Icon name="upload" size="lg" />
                              <span className="text-ui-sm font-medium">
                                Add sound
                              </span>
                            </button>
                          )}
                        {section.sounds.map((sound) => {
                          const isFav = myInstantsFavorites.some(
                            (f) => f.id === sound.id,
                          );
                          const canManage =
                            !selectionMode &&
                            (!sound.serverId || sound.serverId === serverId);
                          return (
                            <SoundTile
                              key={sound.id}
                              name={sound.name}
                              glyph={<SoundGlyph emoji={sound.emoji} />}
                              playLabel={`Play ${sound.name}`}
                              playing={playingSoundIds.has(sound.id)}
                              className={LONG_PRESS_TARGET}
                              {...bindTileLongPress({ sound, isFav })}
                              onPlay={() =>
                                broadcastSound({
                                  id: sound.id,
                                  name: sound.name,
                                  soundType: "server",
                                  dataUrl: sound.dataUrl,
                                  mediaUrl: sound.mediaUrl,
                                  volume: sound.volume,
                                  serverId: sound.serverId,
                                })
                              }
                              actions={[
                                {
                                  key: "preview",
                                  label: `Preview ${sound.name}`,
                                  tooltip: "Preview",
                                  icon: "play",
                                  onClick: (event) =>
                                    previewSound(
                                      { ...sound, soundType: "server" },
                                      event,
                                    ),
                                },
                                ...(canManage
                                  ? [
                                      {
                                        key: "edit",
                                        label: `Edit ${sound.name}`,
                                        tooltip: "Edit",
                                        icon: "edit" as const,
                                        // Touch: edit and delete live in the
                                        // tile's long-press sheet.
                                        className: "pointer-coarse:hidden",
                                        onClick: (
                                          event: React.MouseEvent<HTMLButtonElement>,
                                        ) => openEditModal(sound, event),
                                      },
                                      {
                                        key: "delete",
                                        label: `Delete ${sound.name}`,
                                        tooltip: "Delete",
                                        icon: "trash" as const,
                                        className:
                                          "pointer-coarse:hidden pointer-fine:hover:text-danger-ink",
                                        onClick: (
                                          event: React.MouseEvent<HTMLButtonElement>,
                                        ) => {
                                          event.stopPropagation();
                                          deleteTriggerRef.current =
                                            event.currentTarget;
                                          setSoundToDelete(sound);
                                          setRenderedSoundToDelete(sound);
                                        },
                                      },
                                    ]
                                  : []),
                              ]}
                              favorite={favoriteFor(sound, isFav)}
                            />
                          );
                        })}
                      </div>
                    </section>
                  ))}

                  {/* Default sounds */}
                  {(!deferredSearch || filteredDefault.length > 0) && (
                    <section
                      ref={setSectionRef(DEFAULT_SECTION_ID)}
                      aria-label="Ralph sounds"
                    >
                      <PickerSectionLabel>Ralph sounds</PickerSectionLabel>
                      <div className={SOUND_GRID}>
                        {filteredDefault.map((sound) => {
                          const isFav = myInstantsFavorites.some(
                            (f) => f.id === sound.id,
                          );
                          return (
                            <SoundTile
                              key={sound.id}
                              name={sound.name}
                              glyph={<Icon name="soundboard" size="lg" />}
                              playLabel={`Play ${sound.name}`}
                              playing={playingSoundIds.has(sound.id)}
                              onPlay={() =>
                                broadcastSound({
                                  ...sound,
                                  soundType: "default",
                                })
                              }
                              actions={[
                                {
                                  key: "preview",
                                  label: "Preview",
                                  tooltip: "Preview",
                                  icon: "play",
                                  onClick: (event) =>
                                    previewSound(
                                      { ...sound, soundType: "default" },
                                      event,
                                    ),
                                },
                              ]}
                              favorite={favoriteFor(sound, isFav)}
                            />
                          );
                        })}
                      </div>
                    </section>
                  )}
                </main>
              </div>
            ) : activeView === "myinstants" ? (
              <div
                className="h-full overflow-y-auto overscroll-contain px-1 pb-1"
                onKeyDown={handlePickerGridKeyDown}
              >
                {isSearchingMyInstants && myInstantsResults.length === 0 ? (
                  <div
                    role="status"
                    className="flex items-center justify-center py-12 text-ink-3"
                  >
                    <Spinner className="size-5" />
                    <span className="sr-only">Searching</span>
                  </div>
                ) : myInstantsResults.length === 0 ? (
                  <div className="px-6 py-12 text-center text-ui-sm text-ink-3">
                    No sounds found for "{myInstantsQuery}"
                  </div>
                ) : (
                  <section aria-label="MyInstants sounds">
                    {!myInstantsQuery && myInstantsFavorites.length > 0 ? (
                      <PickerSectionLabel>Trending</PickerSectionLabel>
                    ) : (
                      <div className="h-1" />
                    )}
                    <div className={SOUND_GRID}>
                      {myInstantsResults.map((sound) => {
                        const isFav = myInstantsFavorites.some(
                          (f) => f.id === sound.id,
                        );
                        return (
                          <SoundTile
                            key={sound.id}
                            name={sound.title}
                            glyph={<Icon name="zap" size="lg" />}
                            playLabel={`Play ${sound.title}`}
                            playing={playingSoundIds.has(sound.id)}
                            onPlay={() =>
                              broadcastSound({
                                id: sound.id,
                                name: sound.title,
                                mediaUrl: sound.url,
                              })
                            }
                            actions={[
                              {
                                key: "preview",
                                label: "Preview",
                                tooltip: "Preview",
                                icon: "play",
                                onClick: (event) =>
                                  previewSound(
                                    {
                                      id: sound.id,
                                      name: sound.title,
                                      mediaUrl: sound.url,
                                      soundType: "myinstants",
                                    },
                                    event,
                                  ),
                              },
                            ]}
                            favorite={favoriteFor(sound, isFav)}
                          />
                        );
                      })}
                    </div>
                  </section>
                )}
              </div>
            ) : (
              <div
                className="h-full overflow-y-auto overscroll-contain px-1 pb-1"
                onKeyDown={handlePickerGridKeyDown}
              >
                {isSearchingRadio && radioResults.length === 0 ? (
                  <div
                    role="status"
                    className="flex items-center justify-center py-12 text-ink-3"
                  >
                    <Spinner className="size-5" />
                    <span className="sr-only">Searching</span>
                  </div>
                ) : radioResults.length === 0 ? (
                  <div className="px-6 py-12 text-center text-ui-sm text-ink-3">
                    No stations found for "{radioQuery}"
                  </div>
                ) : (
                  <section aria-label="Stations">
                    {!radioQuery ? (
                      <PickerSectionLabel>Top stations</PickerSectionLabel>
                    ) : (
                      <div className="h-1" />
                    )}
                    <div className={SOUND_GRID}>
                      {radioResults.map((station) => {
                        const isFav = myInstantsFavorites.some(
                          (f) => f.id === station.stationuuid,
                        );
                        const soundObj = {
                          id: station.stationuuid,
                          title: station.name,
                          url: station.url_resolved,
                          color: "#10b981",
                          soundType: "radio" as const,
                          emoji: station.favicon || undefined,
                        };

                        return (
                          <SoundTile
                            key={station.stationuuid}
                            name={station.name}
                            glyph={
                              <StationGlyph
                                favicon={station.favicon || undefined}
                              />
                            }
                            playLabel={`Play ${station.name}`}
                            onPlay={() =>
                              broadcastSound({
                                id: station.stationuuid,
                                name: station.name,
                                mediaUrl: station.url_resolved,
                                soundType: "radio",
                                artworkUrl: station.favicon || undefined,
                              })
                            }
                            actions={[
                              {
                                key: "preview",
                                label: "Preview station",
                                tooltip: "Preview station",
                                icon: "play",
                                onClick: (event) =>
                                  previewSound(
                                    {
                                      id: station.stationuuid,
                                      name: station.name,
                                      mediaUrl: station.url_resolved,
                                      soundType: "radio",
                                    },
                                    event,
                                  ),
                              },
                            ]}
                            favorite={favoriteFor(soundObj, isFav)}
                          />
                        );
                      })}
                    </div>
                  </section>
                )}
              </div>
            )}
          </div>

          {/* Volumes: what the room hears, and what you hear. */}
          {!compact && activeView === "soundboard" && (
            <div className="flex h-11 shrink-0 items-center gap-4 border-t border-line px-3">
              <label className="flex min-w-0 flex-1 items-center gap-2 text-ui-xs font-medium text-ink-3">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="flex shrink-0 cursor-help items-center">
                      <Icon name="voiceChannel" size="sm" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-52">
                    <p className="font-semibold">Send volume</p>
                    <p className="mt-1">
                      Adjusts how loud your soundboard plays for everyone else
                      in the voice channel.
                    </p>
                  </TooltipContent>
                </Tooltip>
                <span className="hidden whitespace-nowrap md:inline">Send</span>
                <input
                  type="range"
                  aria-label="Soundboard volume"
                  min={0}
                  max={100}
                  value={Math.round(sendVolume * 100)}
                  onChange={(event) =>
                    setSendVolume(Number(event.currentTarget.value) / 100)
                  }
                  className="h-1 w-full min-w-0 cursor-pointer accent-primary-fill"
                />
                <Num className="w-8 shrink-0 text-right text-ink-2">
                  {Math.round(sendVolume * 100)}
                </Num>
              </label>
              <label className="flex min-w-0 flex-1 items-center gap-2 text-ui-xs font-medium text-ink-3">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="flex shrink-0 cursor-help items-center">
                      <Icon name="headphones" size="sm" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-52">
                    <p className="font-semibold">Soundboard volume</p>
                    <p className="mt-1">
                      Adjusts how loud soundboard playback is locally for you.
                    </p>
                  </TooltipContent>
                </Tooltip>
                <span className="hidden whitespace-nowrap md:inline">
                  Soundboard
                </span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(playbackVolume * 100)}
                  onChange={(event) => {
                    const nextVolume = Number(event.currentTarget.value) / 100;
                    setPlaybackVolume(nextVolume);
                    setSoundboardMasterVolume(nextVolume);
                    if (localUserId) {
                      scheduleVolumePersistence(nextVolume);
                    }
                  }}
                  className="h-1 w-full min-w-0 cursor-pointer accent-primary-fill"
                />
                <Num className="w-8 shrink-0 text-right text-ink-2">
                  {Math.round(playbackVolume * 100)}
                </Num>
              </label>
            </div>
          )}
        </PickerSurface>
      </TooltipProvider>

      <ActionSheet
        open={tileSheet !== null}
        onOpenChange={(open) => !open && setTileSheet(null)}
        title={tileSheet?.title ?? "Sound actions"}
        showTitle
        items={tileSheet?.items ?? []}
      />

      <UploadSoundModal
        key={renderedEditingSound?.id ?? "new-sound"}
        open={isUploadModalOpen}
        onClose={() => {
          setIsUploadModalOpen(false);
        }}
        onUpload={handleUpload}
        isUploading={isUploading}
        editSound={
          renderedEditingSound
            ? {
                id: renderedEditingSound.id,
                name: renderedEditingSound.name,
                emoji: renderedEditingSound.emoji,
                volume: renderedEditingSound.volume,
              }
            : undefined
        }
      />

      {renderedSoundToDelete && (
        <DeleteSoundDialog
          open={soundToDelete !== null}
          onOpenChange={(open) => !open && setSoundToDelete(null)}
          soundName={renderedSoundToDelete.name}
          soundEmoji={renderedSoundToDelete.emoji}
          onConfirm={async (event) => {
            await handleDeleteSound(renderedSoundToDelete.id, event);
            setSoundToDelete(null);
          }}
        />
      )}
    </>,
    document.body,
  );
}
