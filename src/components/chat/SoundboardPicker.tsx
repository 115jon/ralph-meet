import { useMounted } from "@/hooks/useMounted";
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
import { Icon } from "@/components/ui/icon";
import {
  ActionSheet,
  type ActionSheetItem,
} from "@/components/ui/action-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HIT, PRESS, REVEAL } from "@/components/ui/interaction";
import { LONG_PRESS_TARGET, useLongPress } from "@/hooks/useLongPress";
import {
  useCallback,
  useDeferredValue,
  useEffect,
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
import {
  getSoundboardUploadUrl,
  normalizeSoundboardUploadUrl,
} from "@/lib/voice/soundboard-media";
import {
  toSoundboardCatalogSound,
  type SoundboardCatalogSound,
} from "@/lib/voice/soundboard-catalog";
import { createSoundboardPlaybackId } from "@/lib/voice/soundboard-playback-id";
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
  large = false,
}: {
  server: PickerServer;
  large?: boolean;
}) {
  const iconClassName = large ? "h-10 w-10" : "h-6 w-6";
  if (server.icon_url) {
    return (
      <img
        src={getAuthAssetUrl(server.icon_url)}
        alt=""
        className={cn(
          iconClassName,
          "rounded-full object-cover outline outline-1 outline-black/10 dark:outline-white/10",
        )}
      />
    );
  }

  return (
    <span
      className={cn(
        iconClassName,
        "flex items-center justify-center rounded-full bg-rm-tint-2 text-ui-2xs font-bold text-rm-text-muted",
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

/** A sound tile on the theme surface. */
const TILE =
  "group relative flex aspect-square flex-col items-center justify-center overflow-hidden rounded-lg border border-rm-border bg-rm-bg-surface p-1.5 pointer-fine:hover:bg-rm-tint-1";
/** A tile's corner action (preview, favourite, edit, delete) on a theme tile. */
const TILE_ACTION = cn(
  "flex size-6 items-center justify-center rounded-full bg-rm-tint-2 text-rm-text",
  PRESS,
  HIT,
);
/** The same action over a MyInstants colour tile: a media overlay chip (6.5). */
const TILE_ACTION_MEDIA = cn(
  "flex size-6 items-center justify-center rounded-full bg-black/60 text-white",
  PRESS,
  HIT,
);
/** Rail button (favourites, servers, custom, defaults). */
const RAIL_BUTTON = cn(
  "flex size-10 items-center justify-center self-center rounded-md text-rm-text-muted pointer-fine:hover:text-rm-text",
  PRESS,
  HIT,
);
const RAIL_BUTTON_ON = "bg-rm-tint-2 text-rm-text";
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

function SectionHeader({
  icon,
  title,
  isCollapsed,
  onToggle,
}: {
  icon: React.ReactNode;
  title: string;
  isCollapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="mb-2 flex w-full items-center justify-start gap-2 rounded-md px-1 py-1.5 text-left pointer-fine:hover:bg-rm-tint-1"
    >
      <Icon
        name="chevronDown"
        size="xs"
        className={cn(
          "shrink-0 text-rm-text-muted transition-transform",
          isCollapsed && "-rotate-90",
        )}
      />
      <div className="flex min-w-0 items-center gap-2">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-rm-tint-1 text-rm-text-muted">
          {icon}
        </div>
        <div className="truncate text-ui-xs font-semibold text-rm-text">
          {title}
        </div>
      </div>
    </button>
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

  const [collapsedCategories, setCollapsedCategories] = useState<
    Record<string, boolean>
  >({
    [FAVORITES_SECTION_ID]: false,
    [CUSTOM_SECTION_ID]: false,
    [DEFAULT_SECTION_ID]: false,
  });
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
      title: sound.title || sound.name || "Unknown Sound",
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
      container.scrollTo({
        top: Math.max(0, node.offsetTop - 8),
        behavior: "smooth",
      });
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
    setCollapsedCategories((current) => ({
      ...current,
      [id]: false,
    }));
    pendingJumpIdRef.current = id;
  }, []);

  const toggleSection = useCallback((id: string) => {
    setCollapsedCategories((current) => ({
      ...current,
      [id]: !current[id],
    }));
    setActiveCategory(id);
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
        compact ? 440 : activeView === "listenTogether" ? 980 : 440,
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
      setUploadError(
        error instanceof Error
          ? error.message
          : "Failed to add soundboard clip.",
      );
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

  return createPortal(
    <>
      <TooltipProvider delayDuration={100}>
        <PickerSurface
          open={isPickerOpen}
          modal={false}
          onOpenChange={(nextOpen) => {
            if (!nextOpen && !soundToDelete && !isUploadModalOpen) onClose();
          }}
          ariaLabel="Soundboard picker"
          contentRef={pickerRef}
          stacked={selectionMode}
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
              : compact
                ? "w-[min(440px,calc(100vw-24px))]"
                : selectionMode
                  ? "w-[min(560px,calc(100vw-24px))]"
                  : "w-[min(440px,calc(100vw-24px))]",
            pickerPositionClasses,
          )}
          style={markerRef ? dynamicStyle : undefined}
        >
          <div className="shrink-0 border-b border-rm-border p-3">
            {activeView === "soundboard" ? (
              <>
                <div className="flex items-center gap-2">
                  <div className="relative min-w-0 flex-1">
                    <Icon
                      name="search"
                      size="sm"
                      className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-rm-text-muted"
                    />
                    <Input
                      ref={searchInputRef}
                      type="text"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      aria-label="Search soundboard sounds"
                      placeholder="Search soundboard"
                      className="h-9 pl-9 pointer-coarse:h-11"
                    />
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {!selectionMode && !isDirectMessageScope && (
                      <>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="secondary"
                              size="icon"
                              onClick={() => setActiveView("listenTogether")}
                              aria-label="Listen Together"
                              className="size-9 pointer-coarse:size-11"
                            >
                              <Icon name="headphones" size="sm" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" sideOffset={8}>
                            Listen Together
                          </TooltipContent>
                        </Tooltip>

                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="secondary"
                              size="icon"
                              onClick={() => setActiveView("radio")}
                              aria-label="Search radio"
                              className="size-9 pointer-coarse:size-11"
                            >
                              <Icon name="soundboard" size="sm" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" sideOffset={8}>
                            Search Radio
                          </TooltipContent>
                        </Tooltip>

                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="secondary"
                              size="icon"
                              onClick={() => setActiveView("myinstants")}
                              aria-label="Search MyInstants"
                              className="size-9 pointer-coarse:size-11"
                            >
                              <Icon name="zap" size="sm" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" sideOffset={8}>
                            Search MyInstants
                          </TooltipContent>
                        </Tooltip>
                      </>
                    )}
                  </div>
                </div>
              </>
            ) : activeView === "listenTogether" ? (
              <div className="flex items-center justify-between gap-3">
                <Button
                  variant="ghost"
                  onClick={() => setActiveView("soundboard")}
                >
                  <Icon name="chevronLeft" size="xs" />
                  Back
                </Button>
                <div className="min-w-0 flex-1 text-right">
                  <div className="truncate text-ui-sm font-semibold text-rm-text">
                    Listen Together
                  </div>
                  <div className="truncate text-ui-xs text-rm-text-muted">
                    Synced room playback with a shared queue
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between gap-3">
                  <Button
                    variant="ghost"
                    onClick={() => setActiveView("soundboard")}
                  >
                    <Icon name="chevronLeft" size="xs" />
                    Back
                  </Button>
                  <div className="text-right flex-1 min-w-0 relative">
                    <Icon
                      name="search"
                      size="sm"
                      className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-rm-text-muted"
                    />
                    <Input
                      ref={searchInputRef}
                      type="text"
                      value={
                        activeView === "radio" ? radioQuery : myInstantsQuery
                      }
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
                          ? "Search Radio Stations..."
                          : "Search MyInstants..."
                      }
                      className="h-9 pl-9 pointer-coarse:h-11"
                    />
                  </div>
                </div>
              </>
            )}
            {(uploadError || (activeView === "radio" && roomError)) && (
              <div
                role="alert"
                className="mt-3 rounded-md bg-rm-danger-tint px-3 py-2 text-ui-xs text-rm-danger-ink"
              >
                {activeView === "radio" && roomError
                  ? roomError.message
                  : uploadError}
              </div>
            )}
          </div>

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
                <aside className="flex w-14 shrink-0 flex-col border-r border-rm-border px-2 py-2">
                  <div className="no-scrollbar flex min-h-0 flex-col gap-2 overflow-y-auto overflow-x-hidden pr-1">
                    {!selectionMode && (
                      <>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              onClick={() =>
                                jumpToSection(FAVORITES_SECTION_ID)
                              }
                              aria-label="Favorites"
                              aria-pressed={
                                activeCategory === FAVORITES_SECTION_ID
                              }
                              className={cn(
                                RAIL_BUTTON,
                                activeCategory === FAVORITES_SECTION_ID &&
                                  RAIL_BUTTON_ON,
                              )}
                            >
                              <Icon name="star" size="lg" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="right" sideOffset={10}>
                            Favorites
                          </TooltipContent>
                        </Tooltip>

                        <div className="mx-auto my-1 h-px w-8 bg-rm-border" />
                      </>
                    )}

                    {pickerServers.length > 0 && (
                      <>
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
                                    RAIL_BUTTON,
                                    activeCategory === sectionId &&
                                      RAIL_BUTTON_ON,
                                  )}
                                >
                                  <PickerServerIcon server={server} />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent side="right" sideOffset={10}>
                                <InlineEmojiText text={server.name} />
                              </TooltipContent>
                            </Tooltip>
                          );
                        })}
                      </>
                    )}

                    {!selectionMode &&
                      !isServerSoundboard &&
                      !isDirectMessageScope && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              aria-label="Custom Sounds"
                              onClick={() => jumpToSection(CUSTOM_SECTION_ID)}
                              aria-pressed={
                                activeCategory === CUSTOM_SECTION_ID
                              }
                              className={cn(
                                RAIL_BUTTON,
                                activeCategory === CUSTOM_SECTION_ID &&
                                  RAIL_BUTTON_ON,
                              )}
                            >
                              <Icon name="voiceChannel" size="lg" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="right" sideOffset={10}>
                            {isServerSoundboard
                              ? "Server Sounds"
                              : "Custom Sounds"}
                          </TooltipContent>
                        </Tooltip>
                      )}

                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          aria-label="Ralph Sounds"
                          onClick={() => jumpToSection(DEFAULT_SECTION_ID)}
                          aria-pressed={activeCategory === DEFAULT_SECTION_ID}
                          className={cn(
                            RAIL_BUTTON,
                            activeCategory === DEFAULT_SECTION_ID &&
                              RAIL_BUTTON_ON,
                          )}
                        >
                          <HomeIcon className="size-6" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="right" sideOffset={10}>
                        Ralph Sounds
                      </TooltipContent>
                    </Tooltip>
                  </div>
                </aside>

                <main
                  ref={contentRef}
                  onScroll={handleListScroll}
                  className="no-scrollbar relative min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-3 pt-1 max-md:overscroll-contain"
                >
                  {/* Favorites Section */}
                  {!selectionMode &&
                    (!deferredSearch || visibleFavorites.length > 0) && (
                      <div
                        ref={setSectionRef(FAVORITES_SECTION_ID)}
                        className="mb-6 mt-2 relative"
                      >
                        <SectionHeader
                          icon={
                            <Icon
                              name="star"
                              state="active"
                              size="sm"
                              className="text-rm-accent-ink"
                            />
                          }
                          title="Favorites"
                          isCollapsed={
                            collapsedCategories[FAVORITES_SECTION_ID]
                          }
                          onToggle={() => toggleSection(FAVORITES_SECTION_ID)}
                        />
                        {!collapsedCategories[FAVORITES_SECTION_ID] && (
                          <div className="grid grid-cols-4 gap-2">
                            {visibleFavorites.length === 0 ? (
                              <div className="col-span-4 text-center py-4 text-ui-xs text-rm-text-muted">
                                {isDirectMessageScope
                                  ? "No member-server favorites yet."
                                  : "No favorites yet. Search MyInstants to add some!"}
                              </div>
                            ) : (
                              visibleFavorites.map((sound) => {
                                if (sound.soundType === "myinstants") {
                                  return (
                                    <div
                                      key={`fav-${sound.id}`}
                                      style={{
                                        backgroundColor: sound.color,
                                      }}
                                      className="group relative flex aspect-square flex-col items-center justify-center overflow-hidden rounded-lg p-1"
                                    >
                                      <button
                                        type="button"
                                        className="absolute inset-0 w-full h-full cursor-pointer z-0 outline-none"
                                        aria-label={`Play ${sound.title}`}
                                        onClick={() =>
                                          broadcastSound({
                                            id: sound.id,
                                            name: sound.title,
                                            mediaUrl: sound.url,
                                            soundType: sound.soundType,
                                            serverId:
                                              sound.serverId ??
                                              sound.source_server_id,
                                            source_server_id:
                                              sound.source_server_id,
                                          })
                                        }
                                      />
                                      <div className="absolute inset-1 rounded-full border-2 border-white/20 shadow-inner mix-blend-overlay pointer-events-none z-10" />

                                      <div className="absolute top-1 right-1 z-20 flex flex-col gap-1">
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <button
                                              ref={deleteTriggerRef}
                                              type="button"
                                              aria-label="Remove from favorites"
                                              className={TILE_ACTION_MEDIA}
                                              onClick={(e) =>
                                                toggleFavorite(sound, e)
                                              }
                                            >
                                              <Icon
                                                name="star"
                                                state="active"
                                                size="xs"
                                                className="text-white"
                                              />
                                            </button>
                                          </TooltipTrigger>
                                          <TooltipContent side="left">
                                            Unfavorite
                                          </TooltipContent>
                                        </Tooltip>
                                      </div>

                                      <div
                                        className={cn(
                                          "absolute top-1 left-1 z-20 flex flex-col gap-1",
                                          REVEAL,
                                        )}
                                      >
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <button
                                              type="button"
                                              aria-label="Preview"
                                              className={TILE_ACTION_MEDIA}
                                              onClick={(e) =>
                                                previewSound(
                                                  {
                                                    id: sound.id,
                                                    name: sound.title,
                                                    mediaUrl: sound.url,
                                                    soundType: sound.soundType,
                                                    serverId:
                                                      sound.serverId ??
                                                      sound.source_server_id,
                                                    source_server_id:
                                                      sound.source_server_id,
                                                  },
                                                  e,
                                                )
                                              }
                                            >
                                              <Icon name="play" size="xs" />
                                            </button>
                                          </TooltipTrigger>
                                          <TooltipContent side="right">
                                            Preview
                                          </TooltipContent>
                                        </Tooltip>
                                      </div>

                                      <span className="pointer-events-none z-10 mt-auto w-full rounded-sm bg-black/60 px-1 py-0.5 text-center text-ui-2xs font-semibold leading-tight text-white">
                                        <span className="line-clamp-2">
                                          {sound.title}
                                        </span>
                                      </span>
                                    </div>
                                  );
                                }

                                if (sound.soundType === "radio") {
                                  return (
                                    <div
                                      key={`fav-${sound.id}`}
                                      className={cn(TILE, "p-1")}
                                    >
                                      <button
                                        type="button"
                                        className="absolute inset-0 w-full h-full cursor-pointer z-10 outline-none"
                                        aria-label={`Play ${sound.title}`}
                                        onClick={() =>
                                          broadcastSound({
                                            id: sound.id,
                                            name: sound.title,
                                            mediaUrl: sound.url,
                                            soundType: "radio",
                                            artworkUrl: sound.emoji,
                                          })
                                        }
                                      />

                                      <Icon
                                        name="soundboard"
                                        size="3xl"
                                        className={`absolute text-rm-text-muted/40 opacity-30 pointer-fine:group-hover:opacity-40 transition-opacity pointer-events-none ${sound.emoji ? "hidden radio-fallback" : ""}`}
                                      />

                                      {sound.emoji && (
                                        <img
                                          src={sound.emoji}
                                          onError={(e) => {
                                            e.currentTarget.style.display =
                                              "none";
                                            const fallback =
                                              e.currentTarget.parentElement?.querySelector(
                                                ".radio-fallback",
                                              );
                                            if (fallback)
                                              fallback.classList.remove(
                                                "hidden",
                                              );
                                          }}
                                          className="absolute inset-0 w-full h-full object-cover opacity-30 pointer-fine:group-hover:opacity-40 transition-opacity pointer-events-none"
                                          alt=""
                                        />
                                      )}

                                      <div className="absolute top-1 right-1 z-20 flex flex-col gap-1">
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <button
                                              type="button"
                                              aria-label="Remove from favorites"
                                              className={TILE_ACTION}
                                              onClick={(e) =>
                                                toggleFavorite(sound, e)
                                              }
                                            >
                                              <Icon
                                                name="star"
                                                state="active"
                                                size="xs"
                                                className="text-rm-accent-ink"
                                              />
                                            </button>
                                          </TooltipTrigger>
                                          <TooltipContent side="left">
                                            Unfavorite
                                          </TooltipContent>
                                        </Tooltip>
                                      </div>
                                      <div
                                        className={cn(
                                          "absolute top-1 left-1 z-20 flex flex-col gap-1",
                                          REVEAL,
                                        )}
                                      >
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <button
                                              type="button"
                                              aria-label="Preview station"
                                              className={TILE_ACTION}
                                              onClick={(e) =>
                                                previewSound(
                                                  {
                                                    id: sound.id,
                                                    name: sound.title,
                                                    mediaUrl: sound.url,
                                                    soundType: "radio",
                                                  },
                                                  e,
                                                )
                                              }
                                            >
                                              <Icon name="play" size="xs" />
                                            </button>
                                          </TooltipTrigger>
                                          <TooltipContent side="right">
                                            Preview Station
                                          </TooltipContent>
                                        </Tooltip>
                                      </div>

                                      <span className="pointer-events-none z-10 mt-auto w-full rounded-sm bg-rm-bg-surface/90 px-1 py-0.5 text-center text-ui-2xs font-semibold leading-tight text-rm-text">
                                        <span className="line-clamp-2">
                                          {sound.title}
                                        </span>
                                      </span>
                                    </div>
                                  );
                                }

                                return (
                                  <div key={`fav-${sound.id}`} className={TILE}>
                                    <button
                                      type="button"
                                      className="absolute inset-0 w-full h-full cursor-pointer z-0 outline-none"
                                      aria-label={`Play ${sound.title}`}
                                      onClick={() =>
                                        broadcastSound({
                                          id: sound.id,
                                          name: sound.title,
                                          mediaUrl: sound.url,
                                          soundType: sound.soundType,
                                          serverId:
                                            sound.serverId ??
                                            sound.source_server_id,
                                          source_server_id:
                                            sound.source_server_id,
                                        })
                                      }
                                    />
                                    <div className="pointer-events-none z-10 mb-1 flex items-center justify-center w-6 h-6">
                                      {sound.soundType === "default" ? (
                                        <Icon
                                          name="soundboard"
                                          size="lg"
                                          className="text-rm-text-muted"
                                        />
                                      ) : sound.emoji ? (
                                        <EmojiToken
                                          value={sound.emoji}
                                          className="h-6 w-6 object-contain block"
                                          fallbackClassName="text-ui-xl leading-none block"
                                        />
                                      ) : (
                                        <Icon
                                          name="voiceChannel"
                                          size="lg"
                                          className="text-rm-text-muted"
                                        />
                                      )}
                                    </div>

                                    <div className="absolute top-1 right-1 z-20 flex flex-col gap-1">
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <button
                                            type="button"
                                            aria-label="Remove from favorites"
                                            className={TILE_ACTION}
                                            onClick={(e) =>
                                              toggleFavorite(sound, e)
                                            }
                                          >
                                            <Icon
                                              name="star"
                                              state="active"
                                              size="xs"
                                              className="text-rm-accent-ink"
                                            />
                                          </button>
                                        </TooltipTrigger>
                                        <TooltipContent side="left">
                                          Unfavorite
                                        </TooltipContent>
                                      </Tooltip>
                                    </div>
                                    <div
                                      className={cn(
                                        "absolute top-1 left-1 z-20 flex flex-col gap-1",
                                        REVEAL,
                                      )}
                                    >
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <button
                                            type="button"
                                            aria-label="Preview"
                                            className={TILE_ACTION}
                                            onClick={(e) =>
                                              previewSound(
                                                {
                                                  id: sound.id,
                                                  name: sound.title,
                                                  mediaUrl: sound.url,
                                                  soundType: sound.soundType,
                                                  serverId:
                                                    sound.serverId ??
                                                    sound.source_server_id,
                                                  source_server_id:
                                                    sound.source_server_id,
                                                },
                                                e,
                                              )
                                            }
                                          >
                                            <Icon name="play" size="xs" />
                                          </button>
                                        </TooltipTrigger>
                                        <TooltipContent side="right">
                                          Preview
                                        </TooltipContent>
                                      </Tooltip>
                                    </div>

                                    <span className="pointer-events-none z-10 w-full text-center text-ui-2xs font-semibold leading-tight">
                                      <span className="line-clamp-2">
                                        {sound.title}
                                      </span>
                                    </span>
                                  </div>
                                );
                              })
                            )}
                          </div>
                        )}
                      </div>
                    )}

                  {/* Server and custom sound sections */}
                  {soundSections.map((section) => (
                    <div
                      key={section.id}
                      ref={setSectionRef(section.id)}
                      className="mb-6 relative"
                    >
                      <SectionHeader
                        icon={
                          section.server ? (
                            <PickerServerIcon server={section.server} />
                          ) : (
                            <Icon
                              name="voiceChannel"
                              size="sm"
                              className="text-rm-accent-ink"
                            />
                          )
                        }
                        title={section.server?.name ?? "Custom Sounds"}
                        isCollapsed={collapsedCategories[section.id]}
                        onToggle={() => toggleSection(section.id)}
                      />
                      {!collapsedCategories[section.id] && (
                        <div className="grid grid-cols-4 gap-2">
                          {!deferredSearch &&
                            !selectionMode &&
                            (!section.server ||
                              section.server.id === serverId) && (
                              <button
                                type="button"
                                onClick={() => {
                                  setRenderedEditingSound(null);
                                  setIsUploadModalOpen(true);
                                }}
                                className={cn(
                                  "group flex aspect-square flex-col items-center justify-center overflow-hidden rounded-lg border border-dashed border-rm-border p-1.5 text-rm-text-muted pointer-fine:hover:text-rm-text",
                                  PRESS,
                                )}
                              >
                                <div className="mb-1 flex size-8 items-center justify-center rounded-full bg-rm-tint-1">
                                  <Icon
                                    name="upload"
                                    size="sm"
                                    className="text-rm-accent-ink"
                                  />
                                </div>
                                <span className="w-full text-center text-ui-2xs font-semibold leading-tight">
                                  Add sound
                                </span>
                              </button>
                            )}
                          {section.sounds.map((sound) => {
                            const isFav = myInstantsFavorites.some(
                              (f) => f.id === sound.id,
                            );
                            return (
                              <div
                                key={sound.id}
                                className={cn(TILE, LONG_PRESS_TARGET)}
                                {...bindTileLongPress({ sound, isFav })}
                              >
                                <button
                                  type="button"
                                  className="absolute inset-0 w-full h-full cursor-pointer z-0 outline-none"
                                  aria-label={`Play ${sound.name}`}
                                  onClick={() =>
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
                                />
                                <div className="pointer-events-none z-10 mb-1 flex items-center justify-center w-6 h-6">
                                  {sound.emoji ? (
                                    <EmojiToken
                                      value={sound.emoji}
                                      className="h-6 w-6 object-contain block"
                                      fallbackClassName="text-ui-xl leading-none block"
                                    />
                                  ) : (
                                    <Icon
                                      name="voiceChannel"
                                      size="lg"
                                      className="text-rm-text-muted"
                                    />
                                  )}
                                </div>
                                <span className="pointer-events-none z-10 w-full text-center text-ui-2xs font-semibold leading-tight">
                                  <span className="line-clamp-2">
                                    {sound.name}
                                  </span>
                                </span>

                                <div
                                  className={cn(
                                    "absolute top-1 left-1 z-20 flex flex-col gap-1",
                                    REVEAL,
                                  )}
                                >
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <button
                                        type="button"
                                        aria-label={`Preview ${sound.name}`}
                                        className={TILE_ACTION}
                                        onClick={(e) =>
                                          previewSound(
                                            {
                                              ...sound,
                                              soundType: "server",
                                            },
                                            e,
                                          )
                                        }
                                      >
                                        <Icon name="play" size="xs" />
                                      </button>
                                    </TooltipTrigger>
                                    <TooltipContent
                                      side="right"
                                      className="flex items-center gap-1.5 max-w-[200px]"
                                    >
                                      <span className="shrink-0">Preview</span>
                                      <span className="flex items-center gap-1 font-bold min-w-0">
                                        {sound.emoji && (
                                          <EmojiToken
                                            value={sound.emoji}
                                            className="h-4 w-4 shrink-0"
                                            fallbackClassName="text-ui-sm shrink-0"
                                          />
                                        )}
                                        <span className="truncate">
                                          {sound.name}
                                        </span>
                                      </span>
                                    </TooltipContent>
                                  </Tooltip>
                                  {!selectionMode &&
                                    (!sound.serverId ||
                                      sound.serverId === serverId) && (
                                      <>
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <button
                                              type="button"
                                              aria-label={`Edit ${sound.name}`}
                                              // Touch: edit and delete live in
                                              // the tile's long-press sheet.
                                              className={cn(
                                                TILE_ACTION,
                                                "pointer-coarse:hidden",
                                              )}
                                              onClick={(e) =>
                                                openEditModal(sound, e)
                                              }
                                            >
                                              <Icon name="edit" size="xs" />
                                            </button>
                                          </TooltipTrigger>
                                          <TooltipContent side="right">
                                            Edit
                                          </TooltipContent>
                                        </Tooltip>
                                        <button
                                          type="button"
                                          aria-label={`Delete ${sound.name}`}
                                          title="Delete"
                                          className={cn(
                                            TILE_ACTION,
                                            "pointer-coarse:hidden pointer-fine:hover:text-rm-danger-ink",
                                          )}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            deleteTriggerRef.current =
                                              e.currentTarget;
                                            setSoundToDelete(sound);
                                            setRenderedSoundToDelete(sound);
                                          }}
                                        >
                                          <Icon name="trash" size="xs" />
                                        </button>
                                      </>
                                    )}
                                </div>

                                <div className="absolute top-1 right-1 z-20 flex flex-col gap-1">
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <button
                                        type="button"
                                        aria-label={
                                          isFav
                                            ? "Remove from favorites"
                                            : "Add to favorites"
                                        }
                                        className={cn(
                                          TILE_ACTION,
                                          !isFav && REVEAL,
                                        )}
                                        onClick={(e) =>
                                          toggleFavorite(sound, e)
                                        }
                                      >
                                        <Icon
                                          name="star"
                                          state={isFav ? "active" : "idle"}
                                          size="xs"
                                          className={
                                            isFav
                                              ? "text-rm-accent-ink"
                                              : undefined
                                          }
                                        />
                                      </button>
                                    </TooltipTrigger>
                                    <TooltipContent side="left">
                                      {isFav ? "Unfavorite" : "Favorite"}
                                    </TooltipContent>
                                  </Tooltip>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                      {!section.server && uploadError && (
                        <div className="mt-3 rounded-md bg-rm-danger-tint px-3 py-2 text-ui-xs text-rm-danger-ink">
                          {uploadError}
                        </div>
                      )}
                    </div>
                  ))}

                  {/* Default Sounds Section */}
                  {(!deferredSearch || filteredDefault.length > 0) && (
                    <div
                      ref={setSectionRef(DEFAULT_SECTION_ID)}
                      className="mb-6 relative"
                    >
                      <SectionHeader
                        icon={<HomeIcon className="h-4 w-4" />}
                        title="Ralph Sounds"
                        isCollapsed={collapsedCategories[DEFAULT_SECTION_ID]}
                        onToggle={() => toggleSection(DEFAULT_SECTION_ID)}
                      />
                      {!collapsedCategories[DEFAULT_SECTION_ID] && (
                        <div className="grid grid-cols-4 gap-2">
                          {filteredDefault.map((sound) => {
                            const isFav = myInstantsFavorites.some(
                              (f) => f.id === sound.id,
                            );
                            return (
                              <div key={sound.id} className={TILE}>
                                <button
                                  type="button"
                                  className="absolute inset-0 w-full h-full cursor-pointer z-0 outline-none"
                                  aria-label={`Play ${sound.name}`}
                                  onClick={() =>
                                    broadcastSound({
                                      ...sound,
                                      soundType: "default",
                                    })
                                  }
                                />
                                <Icon
                                  name="soundboard"
                                  size="lg"
                                  className="pointer-events-none z-10 mb-1 text-rm-text-muted"
                                />
                                <span className="pointer-events-none z-10 w-full text-center text-ui-2xs font-semibold leading-tight">
                                  <span className="line-clamp-2">
                                    {sound.name}
                                  </span>
                                </span>

                                <div
                                  className={cn(
                                    "absolute top-1 left-1 z-20 flex flex-col gap-1",
                                    REVEAL,
                                  )}
                                >
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <button
                                        type="button"
                                        aria-label="Preview"
                                        className={TILE_ACTION}
                                        onClick={(e) =>
                                          previewSound(
                                            {
                                              ...sound,
                                              soundType: "default",
                                            },
                                            e,
                                          )
                                        }
                                      >
                                        <Icon name="play" size="xs" />
                                      </button>
                                    </TooltipTrigger>
                                    <TooltipContent side="right">
                                      Preview
                                    </TooltipContent>
                                  </Tooltip>
                                </div>

                                <div className="absolute top-1 right-1 z-20 flex flex-col gap-1">
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <button
                                        type="button"
                                        aria-label={
                                          isFav
                                            ? "Remove from favorites"
                                            : "Add to favorites"
                                        }
                                        className={cn(
                                          TILE_ACTION,
                                          !isFav && REVEAL,
                                        )}
                                        onClick={(e) =>
                                          toggleFavorite(sound, e)
                                        }
                                      >
                                        <Icon
                                          name="star"
                                          state={isFav ? "active" : "idle"}
                                          size="xs"
                                          className={
                                            isFav
                                              ? "text-rm-accent-ink"
                                              : undefined
                                          }
                                        />
                                      </button>
                                    </TooltipTrigger>
                                    <TooltipContent side="left">
                                      {isFav ? "Unfavorite" : "Favorite"}
                                    </TooltipContent>
                                  </Tooltip>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </main>
              </div>
            ) : activeView === "myinstants" ? (
              <div className="flex h-full flex-col p-4 overflow-hidden">
                <div className="flex-1 overflow-y-auto no-scrollbar pb-4 max-md:min-h-0 max-md:overscroll-contain">
                  {isSearchingMyInstants && myInstantsResults.length === 0 ? (
                    <div className="flex items-center justify-center py-12 text-rm-text-muted">
                      <Icon name="loader" size="xl" className="animate-spin" />
                    </div>
                  ) : myInstantsResults.length === 0 ? (
                    <div className="text-center py-12 text-ui-sm text-rm-text-muted">
                      No sounds found for "{myInstantsQuery}"
                    </div>
                  ) : (
                    <div>
                      {!myInstantsQuery && myInstantsFavorites.length > 0 && (
                        <div className="text-ui-2xs font-semibold uppercase tracking-[0.08em] mb-3 text-rm-text-muted">
                          Trending
                        </div>
                      )}
                      <div className="grid grid-cols-4 gap-2 md:grid-cols-5">
                        {myInstantsResults.map((sound) => {
                          const isFav = myInstantsFavorites.some(
                            (f) => f.id === sound.id,
                          );
                          return (
                            <div
                              key={sound.id}
                              style={{ backgroundColor: sound.color }}
                              className="group relative flex aspect-square flex-col items-center justify-center overflow-hidden rounded-lg p-1"
                            >
                              <button
                                type="button"
                                className="absolute inset-0 w-full h-full cursor-pointer z-0 outline-none"
                                aria-label={`Play ${sound.title}`}
                                onClick={() =>
                                  broadcastSound({
                                    id: sound.id,
                                    name: sound.title,
                                    mediaUrl: sound.url,
                                  })
                                }
                              />
                              <div className="absolute inset-1 rounded-full border-2 border-white/20 shadow-inner mix-blend-overlay pointer-events-none z-10" />

                              <div className="absolute top-1 right-1 z-20 flex flex-col gap-1">
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <button
                                      type="button"
                                      aria-label={
                                        isFav
                                          ? "Remove from favorites"
                                          : "Add to favorites"
                                      }
                                      className={cn(
                                        TILE_ACTION_MEDIA,
                                        !isFav && REVEAL,
                                      )}
                                      onClick={(e) => toggleFavorite(sound, e)}
                                    >
                                      <Icon
                                        name="star"
                                        state={isFav ? "active" : "idle"}
                                        size="xs"
                                        className={undefined}
                                      />
                                    </button>
                                  </TooltipTrigger>
                                  <TooltipContent side="left">
                                    {isFav ? "Unfavorite" : "Favorite"}
                                  </TooltipContent>
                                </Tooltip>
                              </div>

                              <div
                                className={cn(
                                  "absolute top-1 left-1 z-20 flex flex-col gap-1",
                                  REVEAL,
                                )}
                              >
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <button
                                      type="button"
                                      aria-label="Preview"
                                      className={TILE_ACTION_MEDIA}
                                      onClick={(e) =>
                                        previewSound(
                                          {
                                            id: sound.id,
                                            name: sound.title,
                                            mediaUrl: sound.url,
                                            soundType: "myinstants",
                                          },
                                          e,
                                        )
                                      }
                                    >
                                      <Icon name="play" size="xs" />
                                    </button>
                                  </TooltipTrigger>
                                  <TooltipContent side="right">
                                    Preview
                                  </TooltipContent>
                                </Tooltip>
                              </div>

                              <span className="pointer-events-none z-10 mt-auto w-full rounded-sm bg-black/60 px-1 py-0.5 text-center text-ui-2xs font-semibold leading-tight text-white">
                                <span className="line-clamp-2">
                                  {sound.title}
                                </span>
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex h-full flex-col p-4 overflow-hidden">
                <div className="flex-1 overflow-y-auto no-scrollbar pb-4 max-md:min-h-0 max-md:overscroll-contain">
                  {isSearchingRadio && radioResults.length === 0 ? (
                    <div className="flex items-center justify-center py-12 text-rm-text-muted">
                      <Icon name="loader" size="xl" className="animate-spin" />
                    </div>
                  ) : radioResults.length === 0 ? (
                    <div className="text-center py-12 text-ui-sm text-rm-text-muted">
                      No stations found for "{radioQuery}"
                    </div>
                  ) : (
                    <div>
                      {!radioQuery && (
                        <div className="text-ui-2xs font-semibold uppercase tracking-[0.08em] mb-3 text-rm-text-muted">
                          Top Stations
                        </div>
                      )}
                      <div className="grid grid-cols-4 gap-2 md:grid-cols-5">
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
                            <div
                              key={station.stationuuid}
                              className={cn(TILE, "p-1")}
                            >
                              <button
                                type="button"
                                className="absolute inset-0 w-full h-full cursor-pointer z-10 outline-none"
                                aria-label={`Play ${station.name}`}
                                onClick={() =>
                                  broadcastSound({
                                    id: station.stationuuid,
                                    name: station.name,
                                    mediaUrl: station.url_resolved,
                                    soundType: "radio",
                                    artworkUrl: station.favicon || undefined,
                                  })
                                }
                              />

                              <Icon
                                name="soundboard"
                                size="3xl"
                                className={`absolute text-rm-text-muted/40 opacity-30 pointer-fine:group-hover:opacity-40 transition-opacity pointer-events-none ${station.favicon ? "hidden radio-fallback" : ""}`}
                              />

                              {station.favicon && (
                                <img
                                  src={station.favicon}
                                  onError={(e) => {
                                    e.currentTarget.style.display = "none";
                                    const fallback =
                                      e.currentTarget.parentElement?.querySelector(
                                        ".radio-fallback",
                                      );
                                    if (fallback)
                                      fallback.classList.remove("hidden");
                                  }}
                                  className="absolute inset-0 w-full h-full object-cover opacity-30 pointer-fine:group-hover:opacity-40 transition-opacity pointer-events-none"
                                  alt=""
                                />
                              )}

                              <div className="absolute top-1 right-1 z-20 flex flex-col gap-1">
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <button
                                      type="button"
                                      aria-label={
                                        isFav
                                          ? "Remove from favorites"
                                          : "Add to favorites"
                                      }
                                      className={cn(
                                        TILE_ACTION,
                                        !isFav && REVEAL,
                                      )}
                                      onClick={(e) =>
                                        toggleFavorite(soundObj, e)
                                      }
                                    >
                                      <Icon
                                        name="star"
                                        state={isFav ? "active" : "idle"}
                                        size="xs"
                                        className={
                                          isFav
                                            ? "text-rm-accent-ink"
                                            : undefined
                                        }
                                      />
                                    </button>
                                  </TooltipTrigger>
                                  <TooltipContent side="left">
                                    {isFav ? "Unfavorite" : "Favorite"}
                                  </TooltipContent>
                                </Tooltip>
                              </div>

                              <div
                                className={cn(
                                  "absolute top-1 left-1 z-20 flex flex-col gap-1",
                                  REVEAL,
                                )}
                              >
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <button
                                      type="button"
                                      aria-label="Preview station"
                                      className={TILE_ACTION}
                                      onClick={(e) =>
                                        previewSound(
                                          {
                                            id: station.stationuuid,
                                            name: station.name,
                                            mediaUrl: station.url_resolved,
                                            soundType: "radio",
                                          },
                                          e,
                                        )
                                      }
                                    >
                                      <Icon name="play" size="xs" />
                                    </button>
                                  </TooltipTrigger>
                                  <TooltipContent side="right">
                                    Preview Station
                                  </TooltipContent>
                                </Tooltip>
                              </div>

                              <span className="pointer-events-none z-10 mt-auto w-full rounded-sm bg-rm-bg-surface/90 px-1 py-0.5 text-center text-ui-2xs font-semibold leading-tight text-rm-text">
                                <span className="line-clamp-2">
                                  {station.name}
                                </span>
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Bottom volume controls */}
          {!compact && activeView === "soundboard" && (
            <div className="shrink-0 border-t border-rm-border p-3">
              <div className="flex gap-2 md:gap-3 items-center w-full">
                <label className="flex w-0 flex-1 items-center gap-2 overflow-hidden rounded-md border border-rm-border px-2 py-2 text-ui-xs font-medium text-rm-text-muted">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex shrink-0 cursor-help items-center rounded-full bg-rm-tint-1 p-1">
                        <Icon
                          name="voiceChannel"
                          size="xs"
                          className="text-rm-accent-ink"
                        />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-[200px]">
                      <p className="font-bold">Send Volume</p>
                      <p className="opacity-80 mt-1">
                        Adjusts how loud your soundboard plays for everyone else
                        in the voice channel.
                      </p>
                    </TooltipContent>
                  </Tooltip>
                  <span className="whitespace-nowrap hidden md:inline">
                    Send
                  </span>
                  <input
                    type="range"
                    aria-label="Soundboard Volume"
                    min={0}
                    max={100}
                    value={Math.round(sendVolume * 100)}
                    onChange={(event) =>
                      setSendVolume(Number(event.currentTarget.value) / 100)
                    }
                    className="h-1 w-full min-w-0 cursor-pointer accent-primary"
                  />
                </label>
                <label className="flex w-0 flex-1 items-center gap-2 overflow-hidden rounded-md border border-rm-border px-2 py-2 text-ui-xs font-medium text-rm-text-muted">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex shrink-0 cursor-help items-center rounded-full bg-rm-tint-1 p-1">
                        <Icon
                          name="headphones"
                          size="xs"
                          className="text-rm-accent-ink"
                        />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-[200px]">
                      <p className="font-bold">Soundboard Volume</p>
                      <p className="opacity-80 mt-1">
                        Adjusts how loud soundboard playback is locally for you.
                      </p>
                    </TooltipContent>
                  </Tooltip>
                  <span className="whitespace-nowrap hidden md:inline">
                    Soundboard
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round(playbackVolume * 100)}
                    onChange={(event) => {
                      const nextVolume =
                        Number(event.currentTarget.value) / 100;
                      setPlaybackVolume(nextVolume);
                      setSoundboardMasterVolume(nextVolume);
                      if (localUserId) {
                        scheduleVolumePersistence(nextVolume);
                      }
                    }}
                    className="h-1 w-full min-w-0 cursor-pointer accent-foreground"
                  />
                </label>
              </div>
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
