import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { apiGet, apiPost, apiUpload, apiDelete, apiPatch } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import {
  ChevronLeft,
  Loader2,
  Search,
  Zap,
  Volume2,
  Upload,
  Play,
  Pause,
  Square,
  Radio,
  Trash2,
  Star,
  ChevronDown,
  Edit2,
  Headphones
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

import { useVoiceSoundboardStore } from "@/stores/useVoiceSoundboardStore";
import { useUserResolution } from "@/hooks/useUserResolution";
import { getAuthAssetUrl } from "@/lib/platform";
import { getDisplayInitial } from "@/lib/display-name";
import {
  DEFAULT_SOUNDBOARD_SOUNDS,
  MAX_SOUNDBOARD_UPLOAD_BYTES,
  getSoundboardServerKey,
  pauseSoundboardPlayback,
  resumeSoundboardPlayback,
  stopSoundboardPlayback,
  setSoundboardMasterVolume,
  getSoundboardMasterVolume,
  playSoundboardPlayback,
} from "@/lib/voice/soundboard";
import EmojiToken from "./EmojiToken";
import { UploadSoundModal, type UploadSoundData } from "./UploadSoundModal";
import { useDelayUnmount } from "@/hooks/useDelayUnmount";

interface Props {
  isClosing?: boolean;
  onClose: () => void;
  placement?: "top-start" | "top-end" | "bottom-start" | "bottom-end";
  markerRef?: React.RefObject<HTMLElement | null>;
  sfu: SFUClient | null;
  serverId?: string | null;
  channelId?: string | null;
  localUserId?: string | null;
}

type SoundboardView = "soundboard" | "myinstants" | "radio";

interface RadioStation {
  stationuuid: string;
  name: string;
  url_resolved: string;
  favicon: string;
  tags: string;
  clickcount: number;
}

interface CustomSound {
  id: string;
  name: string;
  dataUrl?: string;
  mediaUrl?: string;
  emoji?: string;
  volume?: number;
}

interface ServerSoundboardItem {
  id: string;
  name: string;
  file_url: string;
  emoji?: string;
  volume?: number;
}

interface MyInstantsSound {
  id: string;
  title: string;
  url: string;
  color: string;
  emoji?: string;
  soundType?: "myinstants" | "custom" | "default" | "radio";
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
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
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

function NowPlayingItem({ playback, localUserId, serverKey, sfu, setPlaybackPaused }: any) {
  const authorInfo = useUserResolution(playback.ownerId);
  const isPreview = playback.playbackId === "local-preview";

  return (
    <div className={cn("space-y-2 rounded-md px-3 py-2 text-xs font-bold border", isPreview ? "bg-blue-500/10 text-blue-50 border-blue-500/20" : "bg-rm-bg-hover text-rm-text border-rm-border/30")}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 truncate">
          {!isPreview && (
            <div className="h-6 w-6 shrink-0 rounded-full bg-rm-bg-surface overflow-hidden flex items-center justify-center border border-rm-border">
              {authorInfo.avatarUrl ? (
                <img src={getAuthAssetUrl(authorInfo.avatarUrl)} className="h-full w-full object-cover" alt="" />
              ) : (
                <span className="text-[10px] text-rm-text-muted font-bold uppercase">
                  {getDisplayInitial({ name: authorInfo.displayName })}
                </span>
              )}
            </div>
          )}
          {isPreview && (
            <div className="h-6 w-6 shrink-0 rounded-full bg-blue-500/20 text-blue-400 overflow-hidden flex items-center justify-center border border-blue-500/30">
              <Headphones size={12} />
            </div>
          )}
          <div className="flex flex-col min-w-0">
            <span className="truncate">{playback.name}</span>
            <span className={cn("text-[10px] font-normal truncate", isPreview ? "text-blue-300" : "text-rm-text-muted")}>
              {isPreview ? "Local Preview" : `Played by ${authorInfo.displayName}`}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {playback.ownerId === localUserId && (
            <button type="button"
              onClick={() => setPlaybackPaused(playback.playbackId, !playback.paused)}
              className={cn("flex items-center gap-1 rounded px-2 py-1 hover:bg-rm-bg-active hover:text-rm-text", isPreview ? "text-blue-300 hover:bg-blue-500/20" : "text-rm-text-muted")}
            >
              {playback.paused ? <Play size={12} /> : <Pause size={12} />}
            </button>
          )}
          <button type="button"
            onClick={() => {
              stopSoundboardPlayback(playback.playbackId);
              if (!isPreview) {
                sfu?.voiceGW.sendAppEvent({
                  type: "soundboard.stop",
                  server_key: serverKey,
                  user_id: localUserId,
                  playback_id: playback.playbackId,
                });
              }
            }}
            className={cn("flex items-center gap-1 rounded px-2 py-1 hover:bg-red-500/20 hover:text-red-400", isPreview ? "text-blue-300" : "text-rm-text-muted")}
          >
            <Square size={11} />
          </button>
        </div>
      </div>
    </div>
  );
}

function SectionHeader({
  icon,
  title,
  count,
  isCollapsed,
  onToggle,
  accentClassName,
}: {
  icon: React.ReactNode;
  title: string;
  count: number;
  isCollapsed: boolean;
  onToggle: () => void;
  accentClassName?: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="mb-3 flex w-full items-center justify-between gap-3 rounded-xl border border-rm-border/30 bg-rm-bg-surface/30 px-3 py-2 text-left transition-colors hover:bg-rm-bg-hover"
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-rm-border bg-rm-bg-hover shadow-sm dark:shadow-none", accentClassName)}>
          {icon}
        </div>
        <div className="min-w-0">
          <div className="truncate text-[12px] font-black uppercase tracking-[0.12em] text-rm-text">
            {title}
          </div>
          <div className="text-[11px] text-rm-text-muted">
            {count} {count === 1 ? "sound" : "sounds"}
          </div>
        </div>
      </div>
      <ChevronDown
        className={cn(
          "h-4 w-4 shrink-0 text-rm-text-muted transition-transform",
          isCollapsed && "-rotate-90",
        )}
      />
    </button>
  );
}

export default function SoundboardPicker({
  onClose,
  placement = "top-start",
  markerRef,
  sfu,
  serverId,
  channelId,
  localUserId,
}: Props) {
  const [activeView, setActiveView] = useState<SoundboardView>("soundboard");
  const [dynamicStyle, setDynamicStyle] = useState<React.CSSProperties>({ opacity: 0 });
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim());

  const serverKey = getSoundboardServerKey(serverId);
  const storageKey = `voice-soundboard:${serverKey}`;
  const [customSounds, setCustomSounds] = useState<CustomSound[]>([]);
  const [serverSounds, setServerSounds] = useState<CustomSound[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const shouldRenderUploadModal = useDelayUnmount(isUploadModalOpen, 200);
  const [editingSound, setEditingSound] = useState<CustomSound | null>(null);
  const [soundToDelete, setSoundToDelete] = useState<CustomSound | null>(null);
  const [sendVolume, setSendVolume] = useState(0.8);
  const [playbackVolume, setPlaybackVolume] = useState(() => getSoundboardMasterVolume());

  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({
    [FAVORITES_SECTION_ID]: false,
    [CUSTOM_SECTION_ID]: false,
    [DEFAULT_SECTION_ID]: false,
  });
  const [activeCategory, setActiveCategory] = useState<string>(FAVORITES_SECTION_ID);
  const [pendingJumpId, setPendingJumpId] = useState<string | null>(null);

  const [myInstantsQuery, setMyInstantsQuery] = useState("");
  const [myInstantsResults, setMyInstantsResults] = useState<MyInstantsSound[]>([]);
  const [isSearchingMyInstants, setIsSearchingMyInstants] = useState(false);
  const [myInstantsFavorites, setMyInstantsFavorites] = useState<MyInstantsSound[]>([]);
  const [hasFetchedFavorites, setHasFetchedFavorites] = useState(false);

  const [radioQuery, setRadioQuery] = useState("");
  const [radioResults, setRadioResults] = useState<RadioStation[]>([]);
  const [isSearchingRadio, setIsSearchingRadio] = useState(false);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activePlaybacks = useVoiceSoundboardStore((s) => s.activePlaybacks);
  const isServerSoundboard = !!serverId && serverId !== "@me";

  useEffect(() => {
    setSoundboardMasterVolume(playbackVolume);
  }, [playbackVolume]);

  useEffect(() => {
    if (!hasFetchedFavorites) {
      setHasFetchedFavorites(true);
      apiGet<{ favorites: MyInstantsSound[] }>("/api/myinstants/favorites")
        .then((res) => {
          const loaded = res.favorites || [];
          const normalized = loaded.map(sound => ({
            ...sound,
            soundType: sound.soundType || "myinstants" // Default to myinstants if old rows don't have it set yet
          }));
          setMyInstantsFavorites(normalized);
        })
        .catch((err) => console.error("Failed to load MyInstants favorites", err));
    }
  }, [hasFetchedFavorites]);

  const toggleFavorite = async (
    sound: { id: string; name?: string; title?: string; mediaUrl?: string; dataUrl?: string; url?: string; color?: string; emoji?: string; soundType?: "myinstants" | "custom" | "default" | "radio" },
    e: React.MouseEvent
  ) => {
    e.stopPropagation();
    
    let derivedType = sound.soundType;
    if (!derivedType) {
      if (sound.color) derivedType = "myinstants";
      else if (sound.emoji || sound.mediaUrl?.includes("blob:") || sound.dataUrl) derivedType = "custom";
      else derivedType = "default";
    }

    const normalizedSound: MyInstantsSound = {
      id: sound.id,
      title: sound.title || sound.name || "Unknown Sound",
      url: sound.url || sound.mediaUrl || sound.dataUrl || "",
      color: sound.color || "#4f46e5",
      emoji: sound.emoji,
      soundType: derivedType
    };

    const isFav = myInstantsFavorites.some((s) => s.id === sound.id);
    setMyInstantsFavorites((prev) => 
      isFav ? prev.filter((s) => s.id !== sound.id) : [normalizedSound, ...prev]
    );
    try {
      await apiPost("/api/myinstants/favorites", {
        action: isFav ? "remove" : "add",
        sound: normalizedSound
      });
    } catch (err) {
      console.error("Failed to toggle favorite", err);
      setMyInstantsFavorites((prev) => 
        isFav ? [normalizedSound, ...prev] : prev.filter((s) => s.id !== sound.id)
      );
    }
  };

  useEffect(() => {
    if (isServerSoundboard) {
      setCustomSounds([]);
      return;
    }
    setCustomSounds(readStoredSounds(storageKey));
  }, [isServerSoundboard, storageKey]);

  useEffect(() => {
    if (!isServerSoundboard || !serverId) {
      setServerSounds([]);
      return;
    }
    const controller = new AbortController();
    void apiGet<ServerSoundboardItem[]>(`/api/servers/${serverId}/soundboard`, {
      signal: controller.signal,
    })
      .then((sounds) => {
        setServerSounds(
          sounds.map((sound) => ({
            id: sound.id,
            name: sound.name,
            mediaUrl: sound.file_url,
            emoji: sound.emoji,
            volume: sound.volume,
          }))
        );
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          console.error("Failed to load soundboard:", error);
          setServerSounds([]);
        }
      });
    return () => controller.abort();
  }, [isServerSoundboard, serverId]);

  // `sfu.on(...)` returns the unsubscribe function from EventEmitter.on.
  // react-doctor-disable-next-line react-doctor/effect-needs-cleanup
  useEffect(() => {
    if (!sfu || !isServerSoundboard) return;
    return sfu.on("app-event", (event) => {
      const payload = event as SoundboardCatalogUpdatedEvent;
      if (payload.server_key !== serverKey || payload.type !== "soundboard.catalog-updated") return;
      const sound = payload.sound;
      if (
        !sound ||
        typeof sound.id !== "string" ||
        typeof sound.name !== "string" ||
        typeof sound.file_url !== "string"
      ) {
        return;
      }
      const nextSound: CustomSound = {
        id: sound.id,
        name: sound.name,
        mediaUrl: sound.file_url,
        emoji: sound.emoji,
        volume: sound.volume,
      };
      setServerSounds((prev) => [
        nextSound,
        ...prev.filter((entry) => entry.id !== nextSound.id),
      ]);
    });
  }, [isServerSoundboard, sfu, serverKey]);

  useEffect(() => {
    if (activeView !== "myinstants") return;
    const fetchMyInstants = () => {
      const controller = new AbortController();
      setIsSearchingMyInstants(true);
      const queryParams = new URLSearchParams();
      if (myInstantsQuery.trim()) queryParams.set("q", myInstantsQuery.trim());
      apiGet<{results: MyInstantsSound[]}>(`/api/myinstants?${queryParams.toString()}`, { signal: controller.signal })
        .then(res => setMyInstantsResults(res.results || []))
        .catch((err) => {
          if (!controller.signal.aborted) console.error("MyInstants search error", err);
        })
        .finally(() => setIsSearchingMyInstants(false));
      return controller;
    };
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    if (myInstantsQuery.trim()) {
      let controller: AbortController;
      searchTimeoutRef.current = setTimeout(() => {
        controller = fetchMyInstants();
      }, 400);
      return () => {
        if (controller) controller.abort();
        if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
      };
    } else {
      const controller = fetchMyInstants();
      return () => controller.abort();
    }
  }, [activeView, myInstantsQuery]);

  useEffect(() => {
    if (activeView !== "radio") return;
    const fetchRadio = () => {
      const controller = new AbortController();
      setIsSearchingRadio(true);
      let url = "https://de1.api.radio-browser.info/json/stations/topclick/25?hidebroken=true";
      if (radioQuery.trim()) {
        const q = encodeURIComponent(radioQuery.trim());
        url = `https://de1.api.radio-browser.info/json/stations/search?name=${q}&limit=25&hidebroken=true&order=clickcount&reverse=true`;
      }
      fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'RalphMeet/1.0' } })
        .then(res => res.json())
        .then(data => setRadioResults(data))
        .catch((err) => {
          if (!controller.signal.aborted) console.error("Radio search error", err);
        })
        .finally(() => setIsSearchingRadio(false));
      return controller;
    };

    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    if (radioQuery.trim()) {
      let controller: AbortController;
      searchTimeoutRef.current = setTimeout(() => {
        controller = fetchRadio();
      }, 400);
      return () => {
        if (controller) controller.abort();
        if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
      };
    } else {
      const controller = fetchRadio();
      return () => controller.abort();
    }
  }, [activeView, radioQuery]);

  useEffect(() => {
    searchInputRef.current?.focus();
  }, [activeView]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleEscape, { capture: true });
    return () => window.removeEventListener("keydown", handleEscape, { capture: true });
  }, [onClose]);

  useEffect(() => {
    if (!pendingJumpId || activeView !== "soundboard" || deferredSearch) return;
    const container = contentRef.current;
    const node = sectionRefs.current[pendingJumpId];
    if (!container || !node) return;
    const frame = window.requestAnimationFrame(() => {
      container.scrollTo({
        top: Math.max(0, node.offsetTop - 8),
        behavior: "smooth",
      });
      setPendingJumpId(null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeView, deferredSearch, pendingJumpId]);

  const setSectionRef = useCallback(
    (id: string) => (node: HTMLDivElement | null) => {
      sectionRefs.current[id] = node;
    },
    []
  );

  const jumpToSection = useCallback((id: string) => {
    setActiveView("soundboard");
    setSearch("");
    setActiveCategory(id);
    setCollapsedCategories((current) => ({
      ...current,
      [id]: false,
    }));
    setPendingJumpId(id);
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
    const sections = [FAVORITES_SECTION_ID, CUSTOM_SECTION_ID, DEFAULT_SECTION_ID];
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
  }, [activeCategory, deferredSearch]);

  const persistLocalSounds = (next: CustomSound[]) => {
    setCustomSounds(next);
    writeStoredSounds(storageKey, next);
  };

  useEffect(() => {
    let frameId: number;
    const updatePosition = () => {
      if (!markerRef?.current) {
        setDynamicStyle({ opacity: 1 });
        return;
      }
      
      if (window.innerWidth < 640) {
        setDynamicStyle({ opacity: 1 });
        return;
      }

      const rect = markerRef.current.getBoundingClientRect();
      const pickerWidth = 440;
      
      const MAX_HEIGHT = Math.min(820, window.innerHeight - 20);

      const style: React.CSSProperties = { 
        opacity: 1,
        maxHeight: MAX_HEIGHT,
        height: "min(760px, 75vh)",
      };

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

    frameId = window.requestAnimationFrame(updatePosition);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.cancelAnimationFrame(frameId);
    };
  }, [markerRef, placement]);

  const broadcastSound = (sound: { id: string; name: string; dataUrl?: string; mediaUrl?: string; volume?: number; emoji?: string; }) => {
    // Generate a deterministic playback ID so that playing the same sound
    // again by the same user automatically cancels their previous stream
    // locally for all clients and updates the same UI entry in the store.
    const playbackId = `s-${localUserId}-${sound.id}`;
    
    sfu?.voiceGW.sendAppEvent({
      type: "soundboard.play",
      server_key: serverKey,
      user_id: localUserId,
      playback_id: playbackId,
      sound_id: sound.id,
      name: sound.name,
      data_url: sound.dataUrl,
      media_url: sound.mediaUrl,
      volume: sendVolume * (sound.volume ?? 1.0),
    });
  };

  const previewSound = (sound: { id: string; name: string; dataUrl?: string; mediaUrl?: string; volume?: number; emoji?: string; }, e: React.MouseEvent) => {
    e.stopPropagation();
    stopSoundboardPlayback("local-preview");
    
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
        receivedAt: Date.now()
      });
    }, 0);
  };

  const setPlaybackPaused = (playbackId: string, paused: boolean) => {
    if (paused) pauseSoundboardPlayback(playbackId);
    else resumeSoundboardPlayback(playbackId);
    
    if (playbackId !== "local-preview") {
      sfu?.voiceGW.sendAppEvent({
        type: "soundboard.pause-set",
        server_key: serverKey,
        user_id: localUserId,
        playback_id: playbackId,
        paused,
      });
    }
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
      persistLocalSounds(customSounds.filter(s => s.id !== id));
    }
  };

  const handleUpload = async (data: UploadSoundData) => {
    setUploadError(null);
    setIsUploading(true);
    const { file, soundId, soundName, relatedEmoji, soundVolume } = data;
    try {
      if (soundId) { // Edit mode
        if (!isServerSoundboard) {
          const updatedSounds = customSounds.map(s => 
            s.id === soundId ? { ...s, name: soundName, emoji: relatedEmoji || undefined, volume: soundVolume } : s
          );
          persistLocalSounds(updatedSounds);
          setIsUploadModalOpen(false);
          setEditingSound(null);
          return;
        }

        if (!channelId) throw new Error("Join a voice channel to edit server sounds.");
        await apiPatch(`/api/servers/${serverId}/soundboard?soundId=${soundId}`, {
          sound_name: soundName,
          sound_emoji: relatedEmoji,
          sound_volume: soundVolume,
        });
        
        setServerSounds(prev => prev.map(s => 
          s.id === soundId ? { ...s, name: soundName, emoji: relatedEmoji || undefined, volume: soundVolume } : s
        ));
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
        const dataUrl = await fileToDataUrl(file);
        const nextSound = { id: crypto.randomUUID(), name: soundName, dataUrl, emoji: relatedEmoji || undefined, volume: soundVolume };
        persistLocalSounds([nextSound, ...customSounds]);
        setIsUploadModalOpen(false);
        return;
      }
      if (!channelId) {
        throw new Error("Join a voice channel before uploading soundboard audio.");
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
      };
      setServerSounds((prev) => [nextSound, ...prev.filter((entry) => entry.id !== nextSound.id)]);
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
      setUploadError(error instanceof Error ? error.message : "Failed to add soundboard clip.");
    } finally {
      setIsUploading(false);
    }
  };

  const openEditModal = (sound: CustomSound, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingSound(sound);
    setIsUploadModalOpen(true);
  };

  const visibleSounds = isServerSoundboard ? serverSounds : customSounds;
  const filteredFavorites = deferredSearch
    ? myInstantsFavorites.filter(s => s.title.toLowerCase().includes(deferredSearch.toLowerCase()))
    : myInstantsFavorites;
  const filteredCustom = deferredSearch
    ? visibleSounds.filter(s => s.name.toLowerCase().includes(deferredSearch.toLowerCase()))
    : visibleSounds;
  const filteredDefault = deferredSearch
    ? DEFAULT_SOUNDBOARD_SOUNDS.filter(s => s.name.toLowerCase().includes(deferredSearch.toLowerCase()))
    : DEFAULT_SOUNDBOARD_SOUNDS;

  const placementClasses = {
    "top-start": "bottom-[calc(100%+10px)] -left-2 origin-bottom-left",
    "top-end": "bottom-[calc(100%+10px)] right-0 origin-bottom-right",
    "bottom-start": "top-[calc(100%+10px)] -left-2 origin-top-left",
    "bottom-end": "top-[calc(100%+10px)] right-0 origin-top-right",
  }[placement] || "bottom-[calc(100%+10px)] right-0 origin-bottom-right";

  const allServerPlaybacks = Object.values(activePlaybacks)
    .filter((playback) => playback.serverKey === serverKey)
    .sort((a, b) => b.startedAt - a.startedAt);

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[259]"
        onMouseDown={(event) => {
          event.preventDefault();
          onClose();
        }}
        aria-hidden="true"
      />
      <TooltipProvider delayDuration={100}>
        <div
          className={cn(
            "picker-panel fixed z-[260] flex w-full sm:w-[min(440px,calc(100vw-24px))] flex-col overflow-hidden sm:rounded-[26px] border shadow-2xl animate-in fade-in zoom-in-95 duration-150 max-sm:inset-x-0 max-sm:bottom-0 max-sm:top-auto max-sm:h-[85dvh] max-sm:w-full max-sm:rounded-t-[26px] max-sm:rounded-b-none max-sm:border-x-0 max-sm:border-b-0 max-sm:translate-y-0 max-sm:slide-in-from-bottom max-sm:zoom-in-100",
            !markerRef && placementClasses
          )}
          style={markerRef ? dynamicStyle : undefined}
          onMouseDown={(event) => event.stopPropagation()}
          role="dialog"
          aria-modal="true"
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
                      placeholder="Search soundboard"
                      className="picker-search-input h-11 w-full rounded-2xl border pl-10 pr-4 text-[14px] outline-none transition placeholder:text-rm-text-muted focus:border-primary/60"
                    />
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
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
                      <TooltipContent side="bottom" sideOffset={8}>Search Radio</TooltipContent>
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
                  </div>
                </div>
              </>
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
                      value={activeView === "radio" ? radioQuery : myInstantsQuery}
                      onChange={(event) => activeView === "radio" ? setRadioQuery(event.target.value) : setMyInstantsQuery(event.target.value)}
                      placeholder={activeView === "radio" ? "Search Radio Stations..." : "Search MyInstants..."}
                      className="picker-search-input h-10 w-full rounded-2xl border pl-9 pr-3 text-[14px] outline-none transition placeholder:text-rm-text-muted focus:border-primary/60"
                    />
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="min-h-0 flex-1">
            {activeView === "soundboard" ? (
              <div className="flex h-full">
                <aside className="flex w-[68px] shrink-0 flex-col border-r border-rm-border bg-rm-bg-surface/30 px-2 py-3">
                  <div className="no-scrollbar flex min-h-0 flex-col gap-2 overflow-y-auto overflow-x-hidden pr-1">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={() => jumpToSection(FAVORITES_SECTION_ID)}
                          className={cn(
                            "flex h-11 w-11 items-center justify-center self-center rounded-2xl border transition-all",
                            activeCategory === FAVORITES_SECTION_ID
                              ? "border-amber-500/30 dark:border-yellow-500/30 bg-amber-500/10 dark:bg-yellow-500/20 text-amber-600 dark:text-yellow-400"
                              : "border-transparent bg-transparent text-rm-text-muted hover:text-rm-text hover:bg-rm-bg-hover"
                          )}
                        >
                          <Star className="h-5 w-5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="right" sideOffset={10}>Favorites</TooltipContent>
                    </Tooltip>

                    <div className="mx-auto my-1 h-px w-8 bg-rm-border" />

                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={() => jumpToSection(CUSTOM_SECTION_ID)}
                          className={cn(
                            "flex h-11 w-11 items-center justify-center self-center rounded-2xl border transition-all",
                            activeCategory === CUSTOM_SECTION_ID
                              ? "border-primary/30 bg-primary/20 text-primary"
                              : "border-transparent bg-transparent text-rm-text-muted hover:text-rm-text hover:bg-rm-bg-hover"
                          )}
                        >
                          <Volume2 className="h-5 w-5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="right" sideOffset={10}>{isServerSoundboard ? "Server Sounds" : "Custom Sounds"}</TooltipContent>
                    </Tooltip>

                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={() => jumpToSection(DEFAULT_SECTION_ID)}
                          className={cn(
                            "flex h-11 w-11 items-center justify-center self-center rounded-2xl border transition-all",
                            activeCategory === DEFAULT_SECTION_ID
                              ? "border-green-500/30 bg-green-500/20 text-green-500"
                              : "border-transparent bg-transparent text-rm-text-muted hover:text-rm-text hover:bg-rm-bg-hover"
                          )}
                        >
                          <Radio className="h-5 w-5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="right" sideOffset={10}>Default Sounds</TooltipContent>
                    </Tooltip>
                  </div>
                </aside>

                <main
                  ref={contentRef}
                  onScroll={handleListScroll}
                  className="no-scrollbar relative min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-3 pt-1"
                >
                  {/* Favorites Section */}
                  {(!deferredSearch || filteredFavorites.length > 0) && (
                    <div ref={setSectionRef(FAVORITES_SECTION_ID)} className="mb-6 mt-2 relative">
                      <SectionHeader
                        icon={<Star className="h-4 w-4 text-amber-500 dark:text-yellow-400" />}
                        title="Favorites"
                        count={filteredFavorites.length}
                        isCollapsed={collapsedCategories[FAVORITES_SECTION_ID]}
                        onToggle={() => toggleSection(FAVORITES_SECTION_ID)}
                      />
                      {!collapsedCategories[FAVORITES_SECTION_ID] && (
                        <div className="grid grid-cols-4 gap-2">
                          {filteredFavorites.length === 0 ? (
                            <div className="col-span-4 text-center py-4 text-xs text-rm-text-muted">
                              No favorites yet. Search MyInstants to add some!
                            </div>
                          ) : (
                            filteredFavorites.map((sound) => {
                              if (sound.soundType === "myinstants") {
                                return (
                                  <div
                                    key={`fav-${sound.id}`}
                                    style={{ backgroundColor: sound.color }}
                                    className="group relative flex aspect-square flex-col items-center justify-center rounded-xl shadow-[0_4px_0_rgba(0,0,0,0.3)] hover:translate-y-[2px] hover:shadow-[0_2px_0_rgba(0,0,0,0.3)] active:shadow-none active:translate-y-[4px] transition-all p-1 overflow-hidden"
                                  >
                                    <button type="button"
                                      className="absolute inset-0 w-full h-full cursor-pointer z-0 outline-none"
                                      onClick={() => broadcastSound({ id: sound.id, name: sound.title, mediaUrl: sound.url })}
                                    />
                                    <div className="absolute inset-1 rounded-full border-2 border-white/20 shadow-inner mix-blend-overlay pointer-events-none z-10" />
                                    
                                    <div className="absolute top-1 right-1 z-20 flex flex-col gap-1">
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <div 
                                            className="hover:scale-110 active:scale-95 transition-all cursor-pointer opacity-100"
                                            onClick={(e) => toggleFavorite(sound, e)}
                                          >
                                            <Star size={12} className="fill-amber-500 text-amber-500 dark:fill-yellow-400 dark:text-yellow-400 drop-shadow-md" />
                                          </div>
                                        </TooltipTrigger>
                                        <TooltipContent side="left">Unfavorite</TooltipContent>
                                      </Tooltip>
                                    </div>

                                    <div className="absolute top-1 left-1 z-20 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <button type="button" 
                                            className="flex items-center justify-center p-1 rounded-full bg-black/40 backdrop-blur-sm hover:bg-black/60 text-white shadow-sm cursor-pointer"
                                            onClick={(e) => previewSound({ id: sound.id, name: sound.title, mediaUrl: sound.url }, e)}
                                          >
                                            <Play size={10} />
                                          </button>
                                        </TooltipTrigger>
                                        <TooltipContent side="right">Preview</TooltipContent>
                                      </Tooltip>
                                    </div>

                                    <span className="z-10 mt-auto bg-black/60 px-1 py-0.5 text-[9px] leading-tight font-bold text-white rounded text-center w-full shadow-sm pointer-events-none">
                                      <span className="line-clamp-2">{sound.title}</span>
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
                                    <button type="button"
                                      className="absolute inset-0 w-full h-full cursor-pointer z-10 outline-none"
                                      onClick={() => broadcastSound({ id: sound.id, name: sound.title, mediaUrl: sound.url })}
                                    />
                                    
                                    <Radio className={`absolute text-rm-text-muted/40 w-12 h-12 opacity-30 group-hover:opacity-40 transition-opacity pointer-events-none ${sound.emoji ? 'hidden radio-fallback' : ''}`} />
                                    
                                    {sound.emoji && (
                                      <img 
                                        src={sound.emoji} 
                                        onError={(e) => { 
                                          e.currentTarget.style.display = 'none';
                                          const fallback = e.currentTarget.parentElement?.querySelector('.radio-fallback');
                                          if (fallback) fallback.classList.remove('hidden');
                                        }} 
                                        className="absolute inset-0 w-full h-full object-cover opacity-30 group-hover:opacity-40 transition-opacity pointer-events-none" 
                                        alt=""
                                      />
                                    )}
                                    
                                    <div className="absolute top-1 right-1 z-20 flex flex-col gap-1">
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <div 
                                            className="hover:scale-110 active:scale-95 transition-all cursor-pointer opacity-100"
                                            onClick={(e) => toggleFavorite(sound, e)}
                                          >
                                            <Star size={12} className="fill-amber-500 text-amber-500 dark:fill-yellow-400 dark:text-yellow-400 drop-shadow-md" />
                                          </div>
                                        </TooltipTrigger>
                                        <TooltipContent side="left">Unfavorite</TooltipContent>
                                      </Tooltip>
                                    </div>
                                    <div className="absolute top-1 left-1 z-20 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <button type="button" 
                                            className="flex items-center justify-center p-1 rounded-full bg-black/40 backdrop-blur-sm hover:bg-black/60 text-white shadow-sm cursor-pointer"
                                            onClick={(e) => previewSound({ id: sound.id, name: sound.title, mediaUrl: sound.url }, e)}
                                          >
                                            <Play size={10} />
                                          </button>
                                        </TooltipTrigger>
                                        <TooltipContent side="right">Preview Station</TooltipContent>
                                      </Tooltip>
                                    </div>

                                    <span className="z-10 mt-auto bg-rm-bg-floating/90 backdrop-blur-md px-1 py-0.5 text-[9px] leading-tight font-bold text-rm-text rounded text-center w-full shadow-sm pointer-events-none border border-rm-border">
                                      <span className="line-clamp-2">{sound.title}</span>
                                    </span>
                                  </div>
                                );
                              }

                              return (
                                <div
                                  key={`fav-${sound.id}`}
                                  className="group relative flex aspect-square flex-col items-center justify-center rounded-xl bg-rm-bg-surface border border-rm-border hover:border-yellow-500/50 shadow-sm dark:shadow-none hover:shadow-md hover:bg-rm-bg-hover active:scale-95 transition-all p-1.5 overflow-hidden"
                                >
                                  <button type="button"
                                    className="absolute inset-0 w-full h-full cursor-pointer z-0 outline-none"
                                    onClick={() => broadcastSound({ id: sound.id, name: sound.title, mediaUrl: sound.url })}
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
                                        <div 
                                          className="transition-all flex items-center justify-center p-1.5 rounded-full bg-black/70 backdrop-blur-sm hover:bg-black text-white shadow-md cursor-pointer opacity-100"
                                          onClick={(e) => toggleFavorite(sound, e)}
                                        >
                                          <Star size={10} className="fill-yellow-400 text-yellow-400" />
                                        </div>
                                      </TooltipTrigger>
                                      <TooltipContent side="left">Unfavorite</TooltipContent>
                                    </Tooltip>
                                  </div>
                                  <div className="absolute top-1 left-1 z-20 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <button type="button" 
                                          className="flex items-center justify-center p-1.5 rounded-full bg-black/70 backdrop-blur-sm hover:bg-black text-white shadow-md cursor-pointer"
                                          onClick={(e) => previewSound({ id: sound.id, name: sound.title, mediaUrl: sound.url }, e)}
                                        >
                                          <Play size={10} />
                                        </button>
                                      </TooltipTrigger>
                                      <TooltipContent side="right">Preview</TooltipContent>
                                    </Tooltip>
                                  </div>
                                  
                                  <span className="text-[9px] leading-tight font-bold text-center w-full z-10 pointer-events-none">
                                    <span className="line-clamp-2">{sound.title}</span>
                                  </span>
                                </div>
                              );
                            })
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Custom Sounds Section */}
                  {(!deferredSearch || filteredCustom.length > 0 || !deferredSearch) && (
                    <div ref={setSectionRef(CUSTOM_SECTION_ID)} className="mb-6 relative">
                      <SectionHeader
                        icon={<Volume2 className="h-4 w-4 text-primary" />}
                        title={isServerSoundboard ? "Server Sounds" : "Custom Sounds"}
                        count={filteredCustom.length}
                        isCollapsed={collapsedCategories[CUSTOM_SECTION_ID]}
                        onToggle={() => toggleSection(CUSTOM_SECTION_ID)}
                      />
                      {!collapsedCategories[CUSTOM_SECTION_ID] && (
                        <div className="grid grid-cols-4 gap-2">
                          {!deferredSearch && (
                            <button type="button"
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
                          {filteredCustom.map((sound) => {
                            const isFav = myInstantsFavorites.some(f => f.id === sound.id);
                            return (
                              <div
                                key={sound.id}
                                className="group relative flex aspect-square flex-col items-center justify-center rounded-xl bg-rm-bg-surface border border-rm-border hover:border-primary/50 shadow-sm dark:shadow-none hover:shadow-md hover:bg-rm-bg-hover transition-all p-1.5 overflow-hidden"
                              >
                                <button type="button" 
                                  className="absolute inset-0 w-full h-full cursor-pointer z-0 outline-none" 
                                  onClick={() => broadcastSound({ id: sound.id, name: sound.name, dataUrl: sound.dataUrl, mediaUrl: sound.mediaUrl, volume: sound.volume })}
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
                                  <span className="line-clamp-2">{sound.name}</span>
                                </span>
                                
                                <div className="absolute top-1 left-1 z-20 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <button type="button" 
                                        className="flex items-center justify-center p-1.5 rounded-full bg-black/70 backdrop-blur-sm hover:bg-black text-white shadow-md"
                                        onClick={(e) => previewSound(sound, e)}
                                      >
                                        <Play size={10} />
                                      </button>
                                    </TooltipTrigger>
                                    <TooltipContent side="right" className="flex items-center gap-1.5 max-w-[200px]">
                                      <span className="shrink-0">Preview</span>
                                      <span className="flex items-center gap-1 font-bold min-w-0">
                                        {sound.emoji && <EmojiToken value={sound.emoji} className="h-4 w-4 shrink-0" fallbackClassName="text-sm shrink-0" />}
                                        <span className="truncate">{sound.name}</span>
                                      </span>
                                    </TooltipContent>
                                  </Tooltip>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <button type="button" 
                                        className="flex items-center justify-center p-1.5 rounded-full bg-black/70 backdrop-blur-sm hover:bg-black text-white shadow-md"
                                        onClick={(e) => openEditModal(sound, e)}
                                      >
                                        <Edit2 size={10} />
                                      </button>
                                    </TooltipTrigger>
                                    <TooltipContent side="right">Edit</TooltipContent>
                                  </Tooltip>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <button type="button" 
                                        className="flex items-center justify-center p-1.5 rounded-full bg-black/70 backdrop-blur-sm hover:bg-red-500/90 text-white shadow-md"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setSoundToDelete(sound);
                                        }}
                                      >
                                        <Trash2 size={10} />
                                      </button>
                                    </TooltipTrigger>
                                    <TooltipContent side="right">Delete</TooltipContent>
                                  </Tooltip>
                                </div>

                                <div className="absolute top-1 right-1 z-20 flex flex-col gap-1">
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <div 
                                        className={`transition-all cursor-pointer flex items-center justify-center p-1.5 rounded-full bg-black/70 backdrop-blur-sm hover:bg-black text-white shadow-md ${isFav ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                                        onClick={(e) => toggleFavorite(sound, e)}
                                      >
                                        <Star size={10} className={isFav ? "fill-yellow-400 text-yellow-400" : ""} />
                                      </div>
                                    </TooltipTrigger>
                                    <TooltipContent side="left">{isFav ? "Unfavorite" : "Favorite"}</TooltipContent>
                                  </Tooltip>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                      {uploadError && (
                        <div className="mt-3 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-[11px] font-medium text-red-800 dark:text-red-300">
                          {uploadError}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Default Sounds Section */}
                  {(!deferredSearch || filteredDefault.length > 0) && (
                    <div ref={setSectionRef(DEFAULT_SECTION_ID)} className="mb-6 relative">
                      <SectionHeader
                        icon={<Radio className="h-4 w-4 text-green-500" />}
                        title="Default Sounds"
                        count={filteredDefault.length}
                        isCollapsed={collapsedCategories[DEFAULT_SECTION_ID]}
                        onToggle={() => toggleSection(DEFAULT_SECTION_ID)}
                      />
                      {!collapsedCategories[DEFAULT_SECTION_ID] && (
                        <div className="grid grid-cols-4 gap-2">
                          {filteredDefault.map((sound) => {
                            const isFav = myInstantsFavorites.some(f => f.id === sound.id);
                            return (
                              <div
                                key={sound.id}
                                className="group relative flex aspect-square flex-col items-center justify-center rounded-xl bg-rm-bg-surface border border-rm-border hover:border-green-500/50 shadow-sm dark:shadow-none hover:shadow-md hover:bg-rm-bg-hover active:scale-95 transition-all p-1.5 overflow-hidden"
                              >
                                <button type="button"
                                  className="absolute inset-0 w-full h-full cursor-pointer z-0 outline-none"
                                  onClick={() => broadcastSound(sound)}
                                />
                                <Radio className="h-5 w-5 mb-1 text-green-500 opacity-50 group-hover:opacity-100 transition-opacity pointer-events-none z-10" />
                                <span className="text-[9px] leading-tight font-bold text-center w-full z-10 pointer-events-none">
                                  <span className="line-clamp-2">{sound.name}</span>
                                </span>
                                
                                <div className="absolute top-1 left-1 z-20 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <button type="button" 
                                        className="flex items-center justify-center p-1.5 rounded-full bg-black/70 backdrop-blur-sm hover:bg-black text-white shadow-md cursor-pointer"
                                        onClick={(e) => previewSound(sound, e)}
                                      >
                                        <Play size={10} />
                                      </button>
                                    </TooltipTrigger>
                                    <TooltipContent side="right">Preview</TooltipContent>
                                  </Tooltip>
                                </div>

                                <div className="absolute top-1 right-1 z-20 flex flex-col gap-1">
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <div 
                                        className={`transition-all cursor-pointer flex items-center justify-center p-1.5 rounded-full bg-black/70 backdrop-blur-sm hover:bg-black text-white shadow-md ${isFav ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                                        onClick={(e) => toggleFavorite(sound, e)}
                                      >
                                        <Star size={10} className={isFav ? "fill-yellow-400 text-yellow-400" : ""} />
                                      </div>
                                    </TooltipTrigger>
                                    <TooltipContent side="left">{isFav ? "Unfavorite" : "Favorite"}</TooltipContent>
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
                          const isFav = myInstantsFavorites.some(f => f.id === sound.id);
                          return (
                            <div
                              key={sound.id}
                              style={{ backgroundColor: sound.color }}
                              className="group relative flex aspect-square flex-col items-center justify-center rounded-xl shadow-[0_4px_0_rgba(0,0,0,0.3)] hover:translate-y-[2px] hover:shadow-[0_2px_0_rgba(0,0,0,0.3)] active:shadow-none active:translate-y-[4px] transition-all p-1 overflow-hidden"
                            >
                              <button type="button"
                                className="absolute inset-0 w-full h-full cursor-pointer z-0 outline-none"
                                onClick={() => broadcastSound({ id: sound.id, name: sound.title, mediaUrl: sound.url })}
                              />
                              <div className="absolute inset-1 rounded-full border-2 border-white/20 shadow-inner mix-blend-overlay pointer-events-none z-10" />
                              
                              <div className="absolute top-1 right-1 z-20 flex flex-col gap-1">
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <div 
                                      className={`hover:scale-110 active:scale-95 transition-all cursor-pointer ${isFav ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                                      onClick={(e) => toggleFavorite(sound, e)}
                                    >
                                      <Star size={12} className={isFav ? "fill-amber-500 text-amber-500 dark:fill-yellow-400 dark:text-yellow-400 drop-shadow-md" : "text-white/80 hover:text-white drop-shadow-md"} />
                                    </div>
                                  </TooltipTrigger>
                                  <TooltipContent side="left">{isFav ? "Unfavorite" : "Favorite"}</TooltipContent>
                                </Tooltip>
                              </div>

                              <div className="absolute top-1 left-1 z-20 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <button type="button" 
                                      className="flex items-center justify-center p-1 rounded-full bg-black/40 backdrop-blur-sm hover:bg-black/60 text-white shadow-sm cursor-pointer"
                                      onClick={(e) => previewSound({ id: sound.id, name: sound.title, mediaUrl: sound.url }, e)}
                                    >
                                      <Play size={10} />
                                    </button>
                                  </TooltipTrigger>
                                  <TooltipContent side="right">Preview</TooltipContent>
                                </Tooltip>
                              </div>

                              <span className="z-10 mt-auto bg-black/60 px-1 py-0.5 text-[9px] leading-tight font-bold text-white rounded text-center w-full shadow-sm pointer-events-none">
                                <span className="line-clamp-2">{sound.title}</span>
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
                          const isFav = myInstantsFavorites.some(f => f.id === station.stationuuid);
                          const soundObj = {
                            id: station.stationuuid,
                            title: station.name,
                            url: station.url_resolved,
                            color: "#10b981",
                            soundType: "radio" as const,
                            emoji: station.favicon || undefined
                          };
                          
                          return (
                            <div
                              key={station.stationuuid}
                              className="group relative flex aspect-square flex-col items-center justify-center rounded-xl bg-rm-bg-surface border border-rm-border hover:border-green-500/50 shadow-md transition-all p-1 overflow-hidden"
                            >
                              <button type="button"
                                className="absolute inset-0 w-full h-full cursor-pointer z-10 outline-none"
                                onClick={() => broadcastSound({ id: station.stationuuid, name: station.name, mediaUrl: station.url_resolved })}
                              />
                              
                              <Radio className={`absolute text-rm-text-muted/40 w-12 h-12 opacity-30 group-hover:opacity-40 transition-opacity pointer-events-none ${station.favicon ? 'hidden radio-fallback' : ''}`} />
                              
                              {station.favicon && (
                                <img 
                                  src={station.favicon} 
                                  onError={(e) => { 
                                    e.currentTarget.style.display = 'none';
                                    const fallback = e.currentTarget.parentElement?.querySelector('.radio-fallback');
                                    if (fallback) fallback.classList.remove('hidden');
                                  }} 
                                  className="absolute inset-0 w-full h-full object-cover opacity-30 group-hover:opacity-40 transition-opacity pointer-events-none" 
                                  alt=""
                                />
                              )}
                              
                              <div className="absolute top-1 right-1 z-20 flex flex-col gap-1">
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <div 
                                      className={`hover:scale-110 active:scale-95 transition-all cursor-pointer ${isFav ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                                      onClick={(e) => toggleFavorite(soundObj, e)}
                                    >
                                      <Star size={12} className={isFav ? "fill-amber-500 text-amber-500 dark:fill-yellow-400 dark:text-yellow-400 drop-shadow-md" : "text-white/80 hover:text-white drop-shadow-md"} />
                                    </div>
                                  </TooltipTrigger>
                                  <TooltipContent side="left">{isFav ? "Unfavorite" : "Favorite"}</TooltipContent>
                                </Tooltip>
                              </div>

                              <div className="absolute top-1 left-1 z-20 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <button type="button" 
                                      className="flex items-center justify-center p-1 rounded-full bg-black/40 backdrop-blur-sm hover:bg-black/60 text-white shadow-sm cursor-pointer"
                                      onClick={(e) => previewSound({ id: station.stationuuid, name: station.name, mediaUrl: station.url_resolved }, e)}
                                    >
                                      <Play size={10} />
                                    </button>
                                  </TooltipTrigger>
                                  <TooltipContent side="right">Preview Station</TooltipContent>
                                </Tooltip>
                              </div>

                              <span className="z-10 mt-auto bg-rm-bg-floating/90 backdrop-blur-md px-1 py-0.5 text-[9px] leading-tight font-bold text-rm-text rounded text-center w-full shadow-sm pointer-events-none border border-rm-border">
                                <span className="line-clamp-2">{station.name}</span>
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

          {/* Bottom Volume Controls & Now Playing */}
          {activeView === "soundboard" && (
            <div className="shrink-0 border-t border-rm-border bg-rm-bg-floating backdrop-blur-xl p-3">
              <div className="mb-3 h-[105px] flex flex-col">
                <div className="mb-1 shrink-0 text-[10px] font-black uppercase tracking-widest text-rm-text-muted flex items-center justify-between">
                  <span>Now Playing</span>
                  {allServerPlaybacks.length > 0 && (
                    <span className="text-rm-text-muted/50 font-normal">{allServerPlaybacks.length} active</span>
                  )}
                </div>
                <div className="space-y-1.5 flex-1 overflow-y-auto no-scrollbar relative">
                  {allServerPlaybacks.length > 0 ? (
                    allServerPlaybacks.map((playback) => (
                      <NowPlayingItem
                        key={playback.playbackId}
                        playback={playback}
                        localUserId={localUserId}
                        serverKey={serverKey}
                        sfu={sfu}
                        setPlaybackPaused={setPlaybackPaused}
                      />
                    ))
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-xs text-rm-text-muted/50 border border-dashed border-rm-border rounded-xl bg-rm-bg-surface/10">
                      Nothing is playing
                    </div>
                  )}
                </div>
              </div>
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
                      <p className="opacity-80 mt-1">Adjusts how loud your soundboard plays for everyone else in the voice channel.</p>
                    </TooltipContent>
                  </Tooltip>
                  <span className="whitespace-nowrap hidden sm:inline">Send</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round(sendVolume * 100)}
                    onChange={(event) => setSendVolume(Number(event.currentTarget.value) / 100)}
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
                      <p className="font-bold">Receive Volume</p>
                      <p className="opacity-80 mt-1">Adjusts how loud the soundboard plays locally for you.</p>
                    </TooltipContent>
                  </Tooltip>
                  <span className="whitespace-nowrap hidden sm:inline">Receive</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round(playbackVolume * 100)}
                    onChange={(event) => setPlaybackVolume(Number(event.currentTarget.value) / 100)}
                    className="h-1 w-full min-w-0 cursor-pointer accent-foreground"
                  />
                </label>
              </div>
            </div>
          )}

        </div>
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
          editSound={editingSound ? {
            id: editingSound.id,
            name: editingSound.name,
            emoji: editingSound.emoji,
            volume: editingSound.volume
          } : undefined}
        />
      )}

      {soundToDelete && (
        <div
          className="fixed inset-0 z-[270] flex items-center justify-center bg-black/50 dark:bg-black/80 backdrop-blur-sm animate-in fade-in duration-150"
          onMouseDown={(e) => {
            e.stopPropagation();
            setSoundToDelete(null);
          }}
        >
          <div 
            className="flex w-[320px] flex-col overflow-hidden rounded-2xl border border-rm-border bg-rm-bg-surface shadow-[0_22px_80px_rgba(0,0,0,0.8)] animate-in zoom-in-95 duration-150"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="p-4">
              <h2 className="text-lg font-black text-rm-text">Delete Sound</h2>
              <div className="mt-2 text-sm text-rm-text-muted flex flex-col gap-2">
                Are you sure you want to delete this sound?
                <div className="flex items-center justify-center p-3 mt-1 bg-rm-bg-hover rounded-lg border border-rm-border gap-2 font-bold text-rm-text">
                  {soundToDelete.emoji && <EmojiToken value={soundToDelete.emoji} className="h-5 w-5" fallbackClassName="text-base" />}
                  <span>{soundToDelete.name}</span>
                </div>
              </div>
            </div>
            <div className="flex gap-2 bg-rm-bg-floating p-4 border-t border-rm-border">
              <button type="button"
                className="flex-1 rounded-xl bg-rm-bg-hover hover:bg-rm-bg-active py-2 text-sm font-bold text-rm-text transition-colors"
                onClick={() => setSoundToDelete(null)}
              >
                Cancel
              </button>
              <button type="button"
                className="flex-1 rounded-xl bg-red-500 py-2 text-sm font-bold text-white shadow-lg transition-colors hover:bg-red-600"
                onClick={async (e) => {
                  await handleDeleteSound(soundToDelete.id, e);
                  setSoundToDelete(null);
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>,
    document.body
  );
}
