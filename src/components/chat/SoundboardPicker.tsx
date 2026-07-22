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
import { BaseModal } from "@/components/ui/BaseModal";
import {
  ChevronLeft,
  Loader2,
  Search,
  Zap,
  Volume2,
  Upload,
  Play,
  Radio,
  Trash2,
  Star,
  ChevronDown,
  Edit2,
  Headphones,
} from "lucide-react";
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
import { HomeIcon } from "./HomeIcon";
import { UploadSoundModal, type UploadSoundData } from "./UploadSoundModal";
import { useDelayUnmount } from "@/hooks/useDelayUnmount";
import { ListenTogetherPanel } from "./ListenTogetherPanel";

interface Props {
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
        "flex items-center justify-center rounded-full bg-rm-bg-hover text-[10px] font-black text-rm-text-muted",
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
      className="mb-2 flex w-full items-center justify-start gap-2 rounded-lg px-1 py-1.5 text-left transition-colors hover:bg-rm-bg-hover"
    >
      <ChevronDown
        className={cn(
          "h-3.5 w-3.5 shrink-0 text-rm-text-muted transition-transform",
          isCollapsed && "-rotate-90",
        )}
      />
      <div className="flex min-w-0 items-center gap-2">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-rm-bg-hover text-rm-text-muted">
          {icon}
        </div>
        <div className="truncate text-[11px] font-bold text-rm-text">
          {title}
        </div>
      </div>
    </button>
  );
}

export default function SoundboardPicker({
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
  const shouldRenderUploadModal = useDelayUnmount(isUploadModalOpen, 200);
  const [editingSound, setEditingSound] = useState<CustomSound | null>(null);
  const [soundToDelete, setSoundToDelete] = useState<CustomSound | null>(null);
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
  const pickerRef = useRef<HTMLDialogElement>(null);
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
      if (isUploadModalOpen || soundToDelete) return;
      if (
        activeView === "listenTogether" &&
        event.target instanceof HTMLInputElement &&
        event.target.type === "range"
      ) {
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", handleEscape, { capture: true });
    return () =>
      window.removeEventListener("keydown", handleEscape, { capture: true });
  }, [activeView, isUploadModalOpen, onClose, soundToDelete]);

  useEffect(() => {
    if (!compact) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (pickerRef.current?.contains(target)) return;
      if (markerRef?.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    return () =>
      document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
  }, [compact, markerRef, onClose]);

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

      if (window.innerWidth < 640) {
        if (!compact) {
          setDynamicStyle({ opacity: 1 });
          return;
        }
        const compactHeight = Math.min(560, window.innerHeight - 24);
        setDynamicStyle({
          opacity: 1,
          width: Math.min(440, window.innerWidth - 24),
          height: compactHeight,
          maxHeight: compactHeight,
          left: 12,
          top: Math.max(12, window.innerHeight - compactHeight - 12),
        });
        return;
      }

      const rect = markerRef.current.getBoundingClientRect();
      const pickerWidth = Math.min(
        window.innerWidth - 24,
        compact ? 440 : activeView === "listenTogether" ? 980 : 440,
      );

      const MAX_HEIGHT = Math.min(
        compact ? 560 : 820,
        window.innerHeight - (compact ? 24 : 20),
      );

      const style: React.CSSProperties = {
        opacity: 1,
        width: pickerWidth,
        maxHeight: MAX_HEIGHT,
        height: compact
          ? MAX_HEIGHT
          : activeView === "listenTogether"
            ? "min(820px, 82vh)"
            : "min(760px, 75vh)",
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
          setEditingSound(null);
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
        setEditingSound(null);
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
    setEditingSound(sound);
    setIsUploadModalOpen(true);
  };

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
  const pickerOverlayZIndex = selectionMode ? 1090 : 259;
  const pickerPanelZIndex = selectionMode ? 1100 : 260;
  const pickerPositionClasses = compact
    ? ""
    : selectionMode
      ? "inset-0 m-auto h-[min(760px,90dvh)] max-sm:inset-x-0 max-sm:bottom-0 max-sm:top-auto max-sm:m-0 max-sm:h-[85dvh]"
      : !markerRef
        ? placementClasses
        : "";

  return createPortal(
    <>
      {!compact && (
        <div
          className="fixed inset-0"
          style={{ zIndex: pickerOverlayZIndex }}
          onMouseDown={(event) => {
            event.preventDefault();
            onClose();
          }}
          aria-hidden="true"
        />
      )}
      <TooltipProvider delayDuration={100}>
        <dialog
          open
          ref={pickerRef}
          className={cn(
            "picker-panel fixed m-0 flex w-full flex-col overflow-hidden border p-0 shadow-2xl outline-none animate-in fade-in zoom-in-95 duration-150 sm:rounded-[26px]",
            compact
              ? "max-sm:w-[calc(100vw-24px)] max-sm:rounded-2xl"
              : "max-sm:inset-x-0 max-sm:bottom-0 max-sm:top-auto max-sm:h-[85dvh] max-sm:w-full max-sm:rounded-t-[26px] max-sm:rounded-b-none max-sm:border-x-0 max-sm:border-b-0 max-sm:translate-y-0 max-sm:slide-in-from-bottom max-sm:zoom-in-100",
            activeView === "listenTogether"
              ? "sm:w-[min(980px,calc(100vw-24px))]"
              : compact
                ? "sm:w-[min(440px,calc(100vw-24px))]"
                : selectionMode
                  ? "sm:w-[min(560px,calc(100vw-24px))]"
                  : "sm:w-[min(440px,calc(100vw-24px))]",
            pickerPositionClasses,
          )}
          style={{
            ...(markerRef ? dynamicStyle : {}),
            zIndex: pickerPanelZIndex,
          }}
          aria-label="Soundboard picker"
        >
          <div className="picker-header border-b px-4 pb-3 pt-4">
            {activeView === "soundboard" ? (
              <>
                <div className="flex items-center gap-2">
                  <div className="relative min-w-0 flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-rm-text-muted" />
                    <input
                      ref={searchInputRef}
                      type="text"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      aria-label="Search soundboard sounds"
                      placeholder="Search soundboard"
                      className="picker-search-input h-11 w-full rounded-2xl border pl-10 pr-4 text-[14px] outline-none transition placeholder:text-rm-text-muted focus:border-primary/60"
                    />
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {!selectionMode && !isDirectMessageScope && (
                      <>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              onClick={() => setActiveView("listenTogether")}
                              className="inline-flex h-11 items-center gap-2 rounded-2xl border border-rm-border bg-gradient-to-br from-sky-500/20 via-blue-500/20 to-cyan-500/20 px-3 text-sm font-black text-rm-text shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition-transform hover:scale-[1.01] active:scale-[0.99]"
                            >
                              <Headphones className="h-4 w-4 text-sky-300" />
                              <span className="hidden sm:inline">Listen</span>
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" sideOffset={8}>
                            Listen Together
                          </TooltipContent>
                        </Tooltip>

                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              onClick={() => setActiveView("radio")}
                              className="inline-flex h-11 items-center gap-2 rounded-2xl border border-rm-border bg-gradient-to-br from-green-500/20 via-teal-500/20 to-emerald-500/20 px-3 text-sm font-black text-rm-text shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition-transform hover:scale-[1.01] active:scale-[0.99]"
                            >
                              <Radio className="h-4 w-4 text-green-500" />
                              <span className="hidden sm:inline">Radio</span>
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" sideOffset={8}>
                            Search Radio
                          </TooltipContent>
                        </Tooltip>

                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              onClick={() => setActiveView("myinstants")}
                              className="inline-flex h-11 items-center gap-2 rounded-2xl border border-rm-border bg-gradient-to-br from-yellow-500/20 via-rose-500/20 to-blue-500/20 px-3 text-sm font-black text-rm-text shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition-transform hover:scale-[1.01] active:scale-[0.99]"
                            >
                              <Zap className="h-4 w-4 text-primary" />
                              <span className="hidden sm:inline">Discover</span>
                            </button>
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
                <button
                  type="button"
                  onClick={() => setActiveView("soundboard")}
                  className="inline-flex h-10 items-center gap-2 rounded-2xl border border-rm-border bg-rm-bg-hover px-3 text-sm font-semibold text-rm-text transition-colors hover:bg-rm-bg-active"
                >
                  <ChevronLeft className="h-4 w-4" />
                  Back
                </button>
                <div className="min-w-0 flex-1 text-right">
                  <div className="truncate text-sm font-black tracking-[0.12em] text-rm-text">
                    Listen Together
                  </div>
                  <div className="truncate text-xs text-rm-text-muted">
                    Synced room playback with a shared queue
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => setActiveView("soundboard")}
                    className="inline-flex h-10 items-center gap-2 rounded-2xl border border-rm-border bg-rm-bg-hover px-3 text-sm font-semibold text-rm-text transition-colors hover:bg-rm-bg-active"
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Back
                  </button>
                  <div className="text-right flex-1 min-w-0 relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-rm-text-muted" />
                    <input
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
                      className="picker-search-input h-10 w-full rounded-2xl border pl-9 pr-3 text-[14px] outline-none transition placeholder:text-rm-text-muted focus:border-primary/60"
                    />
                  </div>
                </div>
              </>
            )}
            {(uploadError || (activeView === "radio" && roomError)) && (
              <div
                role="alert"
                className="mt-3 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-800 dark:text-red-300"
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
                <aside className="flex w-[68px] shrink-0 flex-col border-r border-rm-border bg-rm-bg-surface/30 px-2 py-3">
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
                              className={cn(
                                "flex h-11 w-11 items-center justify-center self-center rounded-2xl border transition-all",
                                activeCategory === FAVORITES_SECTION_ID
                                  ? "border-amber-500/30 dark:border-yellow-500/30 bg-amber-500/10 dark:bg-yellow-500/20 text-amber-600 dark:text-yellow-400"
                                  : "border-transparent bg-transparent text-rm-text-muted hover:text-rm-text hover:bg-rm-bg-hover",
                              )}
                            >
                              <Star className="h-5 w-5" />
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
                                    "flex h-12 w-12 items-center justify-center self-center rounded-full border transition-[border-radius,background-color,border-color,transform] hover:rounded-2xl active:scale-[0.96]",
                                    activeCategory === sectionId
                                      ? "border-primary/50 bg-primary/20"
                                      : "border-transparent bg-transparent hover:bg-rm-bg-hover",
                                  )}
                                >
                                  <PickerServerIcon server={server} large />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent side="right" sideOffset={10}>
                                {server.name}
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
                              className={cn(
                                "flex h-11 w-11 items-center justify-center self-center rounded-2xl border transition-all",
                                activeCategory === CUSTOM_SECTION_ID
                                  ? "border-primary/30 bg-primary/20 text-primary"
                                  : "border-transparent bg-transparent text-rm-text-muted hover:text-rm-text hover:bg-rm-bg-hover",
                              )}
                            >
                              <Volume2 className="h-5 w-5" />
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
                          className={cn(
                            "flex h-11 w-11 items-center justify-center self-center rounded-2xl border transition-all",
                            activeCategory === DEFAULT_SECTION_ID
                              ? "border-green-500/30 bg-green-500/20 text-green-500"
                              : "border-transparent bg-transparent text-rm-text-muted hover:text-rm-text hover:bg-rm-bg-hover",
                          )}
                        >
                          <span className="scale-[1.3]">
                            <HomeIcon className="h-5 w-5" />
                          </span>
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
                  className="no-scrollbar relative min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-3 pt-1"
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
                            <Star className="h-4 w-4 text-amber-500 dark:text-yellow-400" />
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
                              <div className="col-span-4 text-center py-4 text-xs text-rm-text-muted">
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
                                      style={{ backgroundColor: sound.color }}
                                      className="group relative flex aspect-square flex-col items-center justify-center rounded-xl shadow-[0_4px_0_rgba(0,0,0,0.3)] hover:translate-y-[2px] hover:shadow-[0_2px_0_rgba(0,0,0,0.3)] active:shadow-none active:translate-y-[4px] transition-all p-1 overflow-hidden"
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
                                              type="button"
                                              aria-label="Remove from favorites"
                                              className="hover:scale-110 active:scale-95 transition-all cursor-pointer opacity-100"
                                              onClick={(e) =>
                                                toggleFavorite(sound, e)
                                              }
                                            >
                                              <Star
                                                size={12}
                                                className="fill-amber-500 text-amber-500 dark:fill-yellow-400 dark:text-yellow-400 drop-shadow-md"
                                              />
                                            </button>
                                          </TooltipTrigger>
                                          <TooltipContent side="left">
                                            Unfavorite
                                          </TooltipContent>
                                        </Tooltip>
                                      </div>

                                      <div className="absolute top-1 left-1 z-20 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <button
                                              type="button"
                                              className="flex items-center justify-center p-1 rounded-full bg-black/40 backdrop-blur-sm hover:bg-black/60 text-white shadow-sm cursor-pointer"
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
                                              <Play size={10} />
                                            </button>
                                          </TooltipTrigger>
                                          <TooltipContent side="right">
                                            Preview
                                          </TooltipContent>
                                        </Tooltip>
                                      </div>

                                      <span className="z-10 mt-auto bg-black/60 px-1 py-0.5 text-[9px] leading-tight font-bold text-white rounded text-center w-full shadow-sm pointer-events-none">
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
                                      className="group relative flex aspect-square flex-col items-center justify-center rounded-xl bg-rm-bg-surface border border-rm-border hover:border-green-500/50 shadow-md transition-all p-1 overflow-hidden"
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

                                      <Radio
                                        className={`absolute text-rm-text-muted/40 w-12 h-12 opacity-30 group-hover:opacity-40 transition-opacity pointer-events-none ${sound.emoji ? "hidden radio-fallback" : ""}`}
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
                                          className="absolute inset-0 w-full h-full object-cover opacity-30 group-hover:opacity-40 transition-opacity pointer-events-none"
                                          alt=""
                                        />
                                      )}

                                      <div className="absolute top-1 right-1 z-20 flex flex-col gap-1">
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <button
                                              type="button"
                                              aria-label="Remove from favorites"
                                              className="hover:scale-110 active:scale-95 transition-all cursor-pointer opacity-100"
                                              onClick={(e) =>
                                                toggleFavorite(sound, e)
                                              }
                                            >
                                              <Star
                                                size={12}
                                                className="fill-amber-500 text-amber-500 dark:fill-yellow-400 dark:text-yellow-400 drop-shadow-md"
                                              />
                                            </button>
                                          </TooltipTrigger>
                                          <TooltipContent side="left">
                                            Unfavorite
                                          </TooltipContent>
                                        </Tooltip>
                                      </div>
                                      <div className="absolute top-1 left-1 z-20 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <button
                                              type="button"
                                              className="flex items-center justify-center p-1 rounded-full bg-black/40 backdrop-blur-sm hover:bg-black/60 text-white shadow-sm cursor-pointer"
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
                                              <Play size={10} />
                                            </button>
                                          </TooltipTrigger>
                                          <TooltipContent side="right">
                                            Preview Station
                                          </TooltipContent>
                                        </Tooltip>
                                      </div>

                                      <span className="z-10 mt-auto bg-rm-bg-floating/90 backdrop-blur-md px-1 py-0.5 text-[9px] leading-tight font-bold text-rm-text rounded text-center w-full shadow-sm pointer-events-none border border-rm-border">
                                        <span className="line-clamp-2">
                                          {sound.title}
                                        </span>
                                      </span>
                                    </div>
                                  );
                                }

                                return (
                                  <div
                                    key={`fav-${sound.id}`}
                                    className="group relative flex aspect-square flex-col items-center justify-center rounded-xl bg-rm-bg-surface border border-rm-border hover:border-yellow-500/50 shadow-sm dark:shadow-none hover:shadow-md hover:bg-rm-bg-hover active:scale-95 transition-all p-1.5 overflow-hidden"
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
                                    <div className="pointer-events-none z-10 mb-1 flex items-center justify-center w-6 h-6">
                                      {sound.soundType === "default" ? (
                                        <Radio className="h-5 w-5 text-green-500 opacity-50 group-hover:opacity-100 transition-opacity" />
                                      ) : sound.emoji ? (
                                        <EmojiToken
                                          value={sound.emoji}
                                          className="h-6 w-6 object-contain block"
                                          fallbackClassName="text-xl leading-none block"
                                        />
                                      ) : (
                                        <Volume2 className="h-5 w-5 text-primary opacity-50 group-hover:opacity-100 transition-opacity" />
                                      )}
                                    </div>

                                    <div className="absolute top-1 right-1 z-20 flex flex-col gap-1">
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <button
                                            type="button"
                                            aria-label="Remove from favorites"
                                            className="transition-all flex items-center justify-center p-1.5 rounded-full bg-black/70 backdrop-blur-sm hover:bg-black text-white shadow-md cursor-pointer opacity-100"
                                            onClick={(e) =>
                                              toggleFavorite(sound, e)
                                            }
                                          >
                                            <Star
                                              size={10}
                                              className="fill-yellow-400 text-yellow-400"
                                            />
                                          </button>
                                        </TooltipTrigger>
                                        <TooltipContent side="left">
                                          Unfavorite
                                        </TooltipContent>
                                      </Tooltip>
                                    </div>
                                    <div className="absolute top-1 left-1 z-20 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <button
                                            type="button"
                                            className="flex items-center justify-center p-1.5 rounded-full bg-black/70 backdrop-blur-sm hover:bg-black text-white shadow-md cursor-pointer"
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
                                            <Play size={10} />
                                          </button>
                                        </TooltipTrigger>
                                        <TooltipContent side="right">
                                          Preview
                                        </TooltipContent>
                                      </Tooltip>
                                    </div>

                                    <span className="text-[9px] leading-tight font-bold text-center w-full z-10 pointer-events-none">
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
                            <Volume2 className="h-4 w-4 text-primary" />
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
                                onClick={() => setIsUploadModalOpen(true)}
                                className="group relative flex aspect-square flex-col items-center justify-center rounded-xl bg-rm-bg-surface/30 border-2 border-dashed border-rm-border hover:border-primary/50 hover:bg-rm-bg-hover active:scale-95 transition-all p-1.5 overflow-hidden text-rm-text-muted hover:text-rm-text"
                              >
                                <div className="h-8 w-8 rounded-full bg-rm-bg-surface flex items-center justify-center mb-1 group-hover:bg-primary/20 transition-colors shadow-sm dark:shadow-none">
                                  <Upload className="h-4 w-4 text-primary opacity-70 group-hover:opacity-100 transition-opacity" />
                                </div>
                                <span className="text-[10px] leading-tight font-bold text-center w-full uppercase tracking-wider">
                                  Add Sound
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
                                className="group relative flex aspect-square flex-col items-center justify-center rounded-xl bg-rm-bg-surface border border-rm-border hover:border-primary/50 shadow-sm dark:shadow-none hover:shadow-md hover:bg-rm-bg-hover transition-all p-1.5 overflow-hidden"
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
                                      fallbackClassName="text-xl leading-none block"
                                    />
                                  ) : (
                                    <Volume2 className="h-5 w-5 text-primary opacity-50 group-hover:opacity-100 transition-opacity" />
                                  )}
                                </div>
                                <span className="text-[9px] leading-tight font-bold text-center w-full z-10 pointer-events-none">
                                  <span className="line-clamp-2">
                                    {sound.name}
                                  </span>
                                </span>

                                <div className="absolute top-1 left-1 z-20 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <button
                                        type="button"
                                        aria-label={`Preview ${sound.name}`}
                                        className="flex items-center justify-center p-1.5 rounded-full bg-black/70 backdrop-blur-sm hover:bg-black text-white shadow-md"
                                        onClick={(e) =>
                                          previewSound(
                                            { ...sound, soundType: "server" },
                                            e,
                                          )
                                        }
                                      >
                                        <Play size={10} />
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
                                            fallbackClassName="text-sm shrink-0"
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
                                              className="flex items-center justify-center p-1.5 rounded-full bg-black/70 backdrop-blur-sm hover:bg-black text-white shadow-md"
                                              onClick={(e) =>
                                                openEditModal(sound, e)
                                              }
                                            >
                                              <Edit2 size={10} />
                                            </button>
                                          </TooltipTrigger>
                                          <TooltipContent side="right">
                                            Edit
                                          </TooltipContent>
                                        </Tooltip>
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <button
                                              type="button"
                                              className="flex items-center justify-center p-1.5 rounded-full bg-black/70 backdrop-blur-sm hover:bg-red-500/90 text-white shadow-md"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                setSoundToDelete(sound);
                                              }}
                                            >
                                              <Trash2 size={10} />
                                            </button>
                                          </TooltipTrigger>
                                          <TooltipContent side="right">
                                            Delete
                                          </TooltipContent>
                                        </Tooltip>
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
                                        className={`transition-all cursor-pointer flex items-center justify-center p-1.5 rounded-full bg-black/70 backdrop-blur-sm hover:bg-black text-white shadow-md ${isFav ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
                                        onClick={(e) =>
                                          toggleFavorite(sound, e)
                                        }
                                      >
                                        <Star
                                          size={10}
                                          className={
                                            isFav
                                              ? "fill-yellow-400 text-yellow-400"
                                              : ""
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
                        <div className="mt-3 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-[11px] font-medium text-red-800 dark:text-red-300">
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
                              <div
                                key={sound.id}
                                className="group relative flex aspect-square flex-col items-center justify-center rounded-xl bg-rm-bg-surface border border-rm-border hover:border-green-500/50 shadow-sm dark:shadow-none hover:shadow-md hover:bg-rm-bg-hover active:scale-95 transition-all p-1.5 overflow-hidden"
                              >
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
                                <Radio className="h-5 w-5 mb-1 text-green-500 opacity-50 group-hover:opacity-100 transition-opacity pointer-events-none z-10" />
                                <span className="text-[9px] leading-tight font-bold text-center w-full z-10 pointer-events-none">
                                  <span className="line-clamp-2">
                                    {sound.name}
                                  </span>
                                </span>

                                <div className="absolute top-1 left-1 z-20 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <button
                                        type="button"
                                        className="flex items-center justify-center p-1.5 rounded-full bg-black/70 backdrop-blur-sm hover:bg-black text-white shadow-md cursor-pointer"
                                        onClick={(e) =>
                                          previewSound(
                                            { ...sound, soundType: "default" },
                                            e,
                                          )
                                        }
                                      >
                                        <Play size={10} />
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
                                        className={`transition-all cursor-pointer flex items-center justify-center p-1.5 rounded-full bg-black/70 backdrop-blur-sm hover:bg-black text-white shadow-md ${isFav ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
                                        onClick={(e) =>
                                          toggleFavorite(sound, e)
                                        }
                                      >
                                        <Star
                                          size={10}
                                          className={
                                            isFav
                                              ? "fill-yellow-400 text-yellow-400"
                                              : ""
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
                <div className="flex-1 overflow-y-auto no-scrollbar pb-4">
                  {isSearchingMyInstants && myInstantsResults.length === 0 ? (
                    <div className="flex items-center justify-center py-12 text-rm-text-muted">
                      <Loader2 size={24} className="animate-spin" />
                    </div>
                  ) : myInstantsResults.length === 0 ? (
                    <div className="text-center py-12 text-sm text-rm-text-muted">
                      No sounds found for "{myInstantsQuery}"
                    </div>
                  ) : (
                    <div>
                      {!myInstantsQuery && myInstantsFavorites.length > 0 && (
                        <div className="mb-3 text-xs font-bold text-rm-text-muted uppercase tracking-wider">
                          Trending
                        </div>
                      )}
                      <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
                        {myInstantsResults.map((sound) => {
                          const isFav = myInstantsFavorites.some(
                            (f) => f.id === sound.id,
                          );
                          return (
                            <div
                              key={sound.id}
                              style={{ backgroundColor: sound.color }}
                              className="group relative flex aspect-square flex-col items-center justify-center rounded-xl shadow-[0_4px_0_rgba(0,0,0,0.3)] hover:translate-y-[2px] hover:shadow-[0_2px_0_rgba(0,0,0,0.3)] active:shadow-none active:translate-y-[4px] transition-all p-1 overflow-hidden"
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
                                      className={`hover:scale-110 active:scale-95 transition-all cursor-pointer ${isFav ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
                                      onClick={(e) => toggleFavorite(sound, e)}
                                    >
                                      <Star
                                        size={12}
                                        className={
                                          isFav
                                            ? "fill-amber-500 text-amber-500 dark:fill-yellow-400 dark:text-yellow-400 drop-shadow-md"
                                            : "text-white/80 hover:text-white drop-shadow-md"
                                        }
                                      />
                                    </button>
                                  </TooltipTrigger>
                                  <TooltipContent side="left">
                                    {isFav ? "Unfavorite" : "Favorite"}
                                  </TooltipContent>
                                </Tooltip>
                              </div>

                              <div className="absolute top-1 left-1 z-20 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <button
                                      type="button"
                                      className="flex items-center justify-center p-1 rounded-full bg-black/40 backdrop-blur-sm hover:bg-black/60 text-white shadow-sm cursor-pointer"
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
                                      <Play size={10} />
                                    </button>
                                  </TooltipTrigger>
                                  <TooltipContent side="right">
                                    Preview
                                  </TooltipContent>
                                </Tooltip>
                              </div>

                              <span className="z-10 mt-auto bg-black/60 px-1 py-0.5 text-[9px] leading-tight font-bold text-white rounded text-center w-full shadow-sm pointer-events-none">
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
                <div className="flex-1 overflow-y-auto no-scrollbar pb-4">
                  {isSearchingRadio && radioResults.length === 0 ? (
                    <div className="flex items-center justify-center py-12 text-rm-text-muted">
                      <Loader2 size={24} className="animate-spin" />
                    </div>
                  ) : radioResults.length === 0 ? (
                    <div className="text-center py-12 text-sm text-rm-text-muted">
                      No stations found for "{radioQuery}"
                    </div>
                  ) : (
                    <div>
                      {!radioQuery && (
                        <div className="mb-3 text-xs font-bold text-rm-text-muted uppercase tracking-wider">
                          Top Stations
                        </div>
                      )}
                      <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
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
                              className="group relative flex aspect-square flex-col items-center justify-center rounded-xl bg-rm-bg-surface border border-rm-border hover:border-green-500/50 shadow-md transition-all p-1 overflow-hidden"
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

                              <Radio
                                className={`absolute text-rm-text-muted/40 w-12 h-12 opacity-30 group-hover:opacity-40 transition-opacity pointer-events-none ${station.favicon ? "hidden radio-fallback" : ""}`}
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
                                  className="absolute inset-0 w-full h-full object-cover opacity-30 group-hover:opacity-40 transition-opacity pointer-events-none"
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
                                      className={`hover:scale-110 active:scale-95 transition-all cursor-pointer ${isFav ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
                                      onClick={(e) =>
                                        toggleFavorite(soundObj, e)
                                      }
                                    >
                                      <Star
                                        size={12}
                                        className={
                                          isFav
                                            ? "fill-amber-500 text-amber-500 dark:fill-yellow-400 dark:text-yellow-400 drop-shadow-md"
                                            : "text-white/80 hover:text-white drop-shadow-md"
                                        }
                                      />
                                    </button>
                                  </TooltipTrigger>
                                  <TooltipContent side="left">
                                    {isFav ? "Unfavorite" : "Favorite"}
                                  </TooltipContent>
                                </Tooltip>
                              </div>

                              <div className="absolute top-1 left-1 z-20 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <button
                                      type="button"
                                      className="flex items-center justify-center p-1 rounded-full bg-black/40 backdrop-blur-sm hover:bg-black/60 text-white shadow-sm cursor-pointer"
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
                                      <Play size={10} />
                                    </button>
                                  </TooltipTrigger>
                                  <TooltipContent side="right">
                                    Preview Station
                                  </TooltipContent>
                                </Tooltip>
                              </div>

                              <span className="z-10 mt-auto bg-rm-bg-floating/90 backdrop-blur-md px-1 py-0.5 text-[9px] leading-tight font-bold text-rm-text rounded text-center w-full shadow-sm pointer-events-none border border-rm-border">
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
            <div className="shrink-0 border-t border-rm-border bg-rm-bg-floating backdrop-blur-xl p-3">
              <div className="flex gap-2 sm:gap-3 items-center w-full">
                <label className="flex w-0 flex-1 items-center gap-2 rounded-xl bg-rm-bg-surface/50 border border-rm-border px-2 py-2 text-[10px] font-bold text-rm-text-muted shadow-inner shadow-black/5 dark:shadow-none overflow-hidden">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="shrink-0 flex items-center cursor-help bg-rm-bg-hover rounded-full p-1 shadow-sm dark:shadow-none">
                        <Volume2 size={12} className="text-primary" />
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
                  <span className="whitespace-nowrap hidden sm:inline">
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
                <label className="flex w-0 flex-1 items-center gap-2 rounded-xl bg-rm-bg-surface/50 border border-rm-border px-2 py-2 text-[10px] font-bold text-rm-text-muted shadow-none overflow-hidden">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="shrink-0 flex items-center cursor-help bg-rm-bg-hover rounded-full p-1 shadow-sm dark:shadow-none">
                        <Headphones size={12} className="text-primary" />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-[200px]">
                      <p className="font-bold">Soundboard Volume</p>
                      <p className="opacity-80 mt-1">
                        Adjusts how loud soundboard playback is locally for you.
                      </p>
                    </TooltipContent>
                  </Tooltip>
                  <span className="whitespace-nowrap hidden sm:inline">
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
        </dialog>
      </TooltipProvider>

      {shouldRenderUploadModal && (
        <UploadSoundModal
          onClose={() => {
            setIsUploadModalOpen(false);
            setEditingSound(null);
          }}
          isClosing={!isUploadModalOpen}
          onUpload={handleUpload}
          isUploading={isUploading}
          editSound={
            editingSound
              ? {
                  id: editingSound.id,
                  name: editingSound.name,
                  emoji: editingSound.emoji,
                  volume: editingSound.volume,
                }
              : undefined
          }
        />
      )}

      {soundToDelete && (
        <BaseModal
          onClose={() => setSoundToDelete(null)}
          aria-labelledby="delete-sound-title"
          aria-describedby="delete-sound-description"
        >
          <div
            role="presentation"
            className="fixed inset-0 z-[270] flex items-center justify-center border-0 bg-black/50 p-0 text-left dark:bg-black/80 backdrop-blur-sm animate-in fade-in duration-150"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setSoundToDelete(null);
            }}
          >
            <div
              className="flex w-[320px] flex-col overflow-hidden rounded-2xl border border-rm-border bg-rm-bg-surface shadow-[0_22px_80px_rgba(0,0,0,0.8)] animate-in zoom-in-95 duration-150"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <div className="p-4">
                <h2
                  id="delete-sound-title"
                  className="text-lg font-black text-rm-text"
                >
                  Delete Sound
                </h2>
                <div
                  id="delete-sound-description"
                  className="mt-2 text-sm text-rm-text-muted flex flex-col gap-2"
                >
                  Are you sure you want to delete this sound?
                  <div className="flex items-center justify-center p-3 mt-1 bg-rm-bg-hover rounded-lg border border-rm-border gap-2 font-bold text-rm-text">
                    {soundToDelete.emoji && (
                      <EmojiToken
                        value={soundToDelete.emoji}
                        className="h-5 w-5"
                        fallbackClassName="text-base"
                      />
                    )}
                    <span>{soundToDelete.name}</span>
                  </div>
                </div>
              </div>
              <div className="flex gap-2 bg-rm-bg-floating p-4 border-t border-rm-border">
                <button
                  type="button"
                  className="flex-1 rounded-xl bg-rm-bg-hover hover:bg-rm-bg-active py-2 text-sm font-bold text-rm-text transition-colors"
                  onClick={() => setSoundToDelete(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="flex-1 rounded-xl bg-red-500 py-2 text-sm font-bold text-white shadow-lg transition-colors hover:bg-red-600"
                  onClick={async (event) => {
                    await handleDeleteSound(soundToDelete.id, event);
                    setSoundToDelete(null);
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        </BaseModal>
      )}
    </>,
    document.body,
  );
}
