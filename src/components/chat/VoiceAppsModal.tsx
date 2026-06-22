import type { SFUClient } from "@/lib/sfu-client";
import { apiGet, apiUpload, apiDelete, apiPost } from "@/lib/api-client";
import {
  DEFAULT_SOUNDBOARD_SOUNDS,
  MAX_SOUNDBOARD_UPLOAD_BYTES,
  getSoundboardServerKey,
  pauseSoundboardPlayback,
  resumeSoundboardPlayback,
  setSoundboardPlaybackVolume,
  stopSoundboardPlayback,
  setSoundboardMasterVolume,
} from "@/lib/voice/soundboard";
import { cn } from "@/lib/utils";
import { useVoiceActivityStore } from "@/stores/useVoiceActivityStore";
import { useVoiceSoundboardStore } from "@/stores/useVoiceSoundboardStore";
import { Loader2, Pause, Play, Radio, Square, Upload, Volume2, X, Search, Trash2, Star } from "lucide-react";
import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { useUserResolution } from "@/hooks/useUserResolution";
import { getAuthAssetUrl } from "@/lib/platform";
import { getDisplayInitial } from "@/lib/display-name";

type Tab = "activities" | "soundboard" | "myinstants";

function NowPlayingItem({ playback, localUserId, serverKey, sfu, setPlaybackPaused }: any) {
  const authorInfo = useUserResolution(playback.ownerId);

  return (
    <div className="space-y-2 rounded-md bg-rm-bg-hover px-3 py-2 text-xs font-bold text-rm-text">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 truncate">
          <div className="h-6 w-6 shrink-0 rounded-full bg-rm-bg-surface overflow-hidden flex items-center justify-center border border-rm-border">
            {authorInfo.avatarUrl ? (
              <img src={getAuthAssetUrl(authorInfo.avatarUrl)} className="h-full w-full object-cover" alt="" />
            ) : (
              <span className="text-[10px] text-rm-text-muted font-bold uppercase">
                {getDisplayInitial({ name: authorInfo.displayName })}
              </span>
            )}
          </div>
          <div className="flex flex-col min-w-0">
            <span className="truncate">{playback.name}</span>
            <span className="text-[10px] font-normal text-rm-text-muted truncate">Played by {authorInfo.displayName}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {playback.ownerId === localUserId && (
            <button
              onClick={() => setPlaybackPaused(playback.playbackId, !playback.paused)}
              className="flex items-center gap-1 rounded px-2 py-1 text-rm-text-muted hover:bg-rm-bg-active hover:text-rm-text"
            >
              {playback.paused ? <Play size={12} /> : <Pause size={12} />}
              {playback.paused ? "Resume" : "Pause"}
            </button>
          )}
          <button
            onClick={() => {
              stopSoundboardPlayback(playback.playbackId);
              sfu?.voiceGW.sendAppEvent({
                type: "soundboard.stop",
                server_key: serverKey,
                user_id: localUserId,
                playback_id: playback.playbackId,
              });
            }}
            className="flex items-center gap-1 rounded px-2 py-1 text-rm-text-muted hover:bg-rm-bg-active hover:text-rm-text"
          >
            <Square size={11} /> Stop
          </button>
        </div>
      </div>
    </div>
  );
}

interface VoiceAppsModalProps {
  isOpen: boolean;
  initialTab: Tab;
  onClose: () => void;
  sfu: SFUClient | null;
  serverId?: string | null;
  channelId?: string | null;
  localUserId?: string | null;
  gridItems: Array<{ userId: string; name: string; isLocal?: boolean }>;
}

interface CustomSound {
  id: string;
  name: string;
  dataUrl?: string;
  mediaUrl?: string;
}

interface ServerSoundboardItem {
  id: string;
  name: string;
  file_url: string;
}

interface MyInstantsSound {
  id: string;
  title: string;
  url: string;
  color: string;
}

interface SoundboardCatalogUpdatedEvent {
  server_key?: string;
  type?: string;
  sound?: {
    id?: string;
    name?: string;
    file_url?: string;
  };
}

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

function WordleLogo() {
  return (
    <div className="grid h-11 w-11 grid-cols-3 gap-[2px] rounded-sm bg-white p-[3px] shadow-sm">
      {Array.from({ length: 9 }).map((_, index) => (
        <div
          key={index}
          className={cn(
            "rounded-[1px] border border-black/80",
            index >= 6 ? "bg-[#6aaa64]" : index === 3 || index === 4 ? "bg-[#c9b458]" : "bg-white"
          )}
        />
      ))}
    </div>
  );
}

export function VoiceAppsModal({
  isOpen,
  initialTab,
  onClose,
  sfu,
  serverId,
  channelId,
  localUserId,
  gridItems,
}: VoiceAppsModalProps) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const serverKey = getSoundboardServerKey(serverId);
  const storageKey = `voice-soundboard:${serverKey}`;
  const [customSounds, setCustomSounds] = useState<CustomSound[]>([]);
  const [serverSounds, setServerSounds] = useState<CustomSound[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [sendVolume, setSendVolume] = useState(0.8);
  const [playbackVolume, setPlaybackVolume] = useState(() => {
    if (typeof localStorage !== "undefined") {
      return Number(localStorage.getItem("voice-soundboard:master-volume") ?? "1");
    }
    return 1.0;
  });

  useEffect(() => {
    setSoundboardMasterVolume(playbackVolume);
  }, [playbackVolume]);

  // MyInstants state
  const [myInstantsQuery, setMyInstantsQuery] = useState("");
  const [myInstantsResults, setMyInstantsResults] = useState<MyInstantsSound[]>([]);
  const [isSearchingMyInstants, setIsSearchingMyInstants] = useState(false);
  const [myInstantsFavorites, setMyInstantsFavorites] = useState<MyInstantsSound[]>([]);
  const [hasFetchedFavorites, setHasFetchedFavorites] = useState(false);

  useEffect(() => {
    if (tab === "myinstants" && !hasFetchedFavorites) {
      setHasFetchedFavorites(true);
      apiGet<{ favorites: MyInstantsSound[] }>("/api/myinstants/favorites")
        .then((res) => setMyInstantsFavorites(res.favorites || []))
        .catch((err) => console.error("Failed to load MyInstants favorites", err));
    }
  }, [tab, hasFetchedFavorites]);

  const toggleMyInstantsFavorite = async (sound: MyInstantsSound, e: React.MouseEvent) => {
    e.stopPropagation();
    const isFav = myInstantsFavorites.some((s) => s.id === sound.id);
    
    // Optimistic update
    setMyInstantsFavorites((prev) => 
      isFav ? prev.filter((s) => s.id !== sound.id) : [sound, ...prev]
    );

    try {
      await apiPost("/api/myinstants/favorites", {
        action: isFav ? "remove" : "add",
        sound
      });
    } catch (err) {
      console.error("Failed to toggle favorite", err);
      // Revert on failure
      setMyInstantsFavorites((prev) => 
        isFav ? [sound, ...prev] : prev.filter((s) => s.id !== sound.id)
      );
    }
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const setUserActivity = useVoiceActivityStore((s) => s.setUserActivity);
  const activePlaybacks = useVoiceSoundboardStore((s) => s.activePlaybacks);
  const isServerSoundboard = !!serverId && serverId !== "@me";

  const participants = useMemo(() => {
    const byId = new Map<string, { userId: string; name: string }>();
    for (const item of gridItems) {
      if (item.userId) byId.set(item.userId, { userId: item.userId, name: item.name });
    }
    return [...byId.values()];
  }, [gridItems]);

  useEffect(() => {
    if (!isOpen) return;
    setTab(initialTab);
  }, [initialTab, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    if (isServerSoundboard) {
      setCustomSounds([]);
      return;
    }

    setCustomSounds(readStoredSounds(storageKey));
  }, [isOpen, isServerSoundboard, storageKey]);

  useEffect(() => {
    if (!isOpen || !isServerSoundboard || !serverId) {
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
  }, [isOpen, isServerSoundboard, serverId]);

  useEffect(() => {
    if (!isOpen || !sfu || !isServerSoundboard) return;

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
      };

      setServerSounds((prev) => [
        nextSound,
        ...prev.filter((entry) => entry.id !== nextSound.id),
      ]);
    });
  }, [isOpen, isServerSoundboard, sfu, serverKey]);

  // MyInstants fetching
  useEffect(() => {
    if (!isOpen || tab !== "myinstants") return;

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
    
    // Debounce search
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
  }, [isOpen, tab, myInstantsQuery]);

  const visibleSounds = isServerSoundboard ? serverSounds : customSounds;
  const uploadLabel = isServerSoundboard ? "Upload server sound" : "Upload local sound";
  const allServerPlaybacks = Object.values(activePlaybacks)
    .filter((playback) => playback.serverKey === serverKey)
    .sort((a, b) => b.startedAt - a.startedAt);

  if (!isOpen) return null;

  const persistLocalSounds = (next: CustomSound[]) => {
    setCustomSounds(next);
    writeStoredSounds(storageKey, next);
  };

  const broadcastSound = (sound: { id: string; name: string; dataUrl?: string; mediaUrl?: string }) => {
    const playbackId = crypto.randomUUID();
    sfu?.voiceGW.sendAppEvent({
      type: "soundboard.play",
      server_key: serverKey,
      user_id: localUserId,
      playback_id: playbackId,
      sound_id: sound.id,
      name: sound.name,
      data_url: sound.dataUrl,
      media_url: sound.mediaUrl,
      volume: sendVolume, // Send Volume affects what others hear
    });
  };

  const setPlaybackPaused = (playbackId: string, paused: boolean) => {
    if (paused) pauseSoundboardPlayback(playbackId);
    else resumeSoundboardPlayback(playbackId);
    sfu?.voiceGW.sendAppEvent({
      type: "soundboard.pause-set",
      server_key: serverKey,
      user_id: localUserId,
      playback_id: playbackId,
      paused,
    });
  };

  const setLocalPlaybackVolume = (playbackId: string, volume: number) => {
    setSoundboardPlaybackVolume(playbackId, volume);
    sfu?.voiceGW.sendAppEvent({
      type: "soundboard.volume-set",
      server_key: serverKey,
      user_id: localUserId,
      playback_id: playbackId,
      volume,
    });
  };

  const startWordle = () => {
    if (!localUserId || !channelId) return;
    const presence = { userId: localUserId, channelId, activity: "wordle" as const, startedAt: Date.now() };
    setUserActivity(presence);
    sfu?.voiceGW.sendAppEvent({ type: "activity.start", ...presence });
    onClose();
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

  const handleUpload = async (file: File) => {
    setUploadError(null);
    setIsUploading(true);

    try {
      if (!isSoundboardAudioFile(file)) {
        throw new Error("Only audio files can be uploaded to the soundboard.");
      }

      const soundName = file.name.replace(/\.[^.]+$/, "");

      if (!isServerSoundboard) {
        const dataUrl = await fileToDataUrl(file);
        const nextSound = { id: crypto.randomUUID(), name: soundName, dataUrl };
        persistLocalSounds([nextSound, ...customSounds]);
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
      };

      setServerSounds((prev) => [nextSound, ...prev.filter((entry) => entry.id !== nextSound.id)]);
      sfu?.voiceGW.sendAppEvent({
        type: "soundboard.catalog-updated",
        server_key: serverKey,
        user_id: localUserId,
        sound: {
          id: nextSound.id,
          name: nextSound.name,
          file_url: nextSound.mediaUrl,
        },
      });
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Failed to add soundboard clip.");
    } finally {
      setIsUploading(false);
      fileInputRef.current && (fileInputRef.current.value = "");
    }
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    await handleUpload(file);
  };

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm">
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-rm-border bg-rm-bg-elevated shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-rm-border px-4 py-3 bg-rm-bg-surface/50 backdrop-blur-md">
          <div className="flex items-center gap-2">
            {(["activities", "soundboard", "myinstants"] as Tab[]).map((value) => (
              <button
                key={value}
                onClick={() => setTab(value)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-bold capitalize transition-colors",
                  tab === value ? "bg-primary text-primary-foreground" : "text-rm-text-muted hover:bg-rm-bg-hover hover:text-rm-text"
                )}
              >
                {value}
              </button>
            ))}
          </div>
          <button onClick={onClose} className="rounded-md p-1.5 text-rm-text-muted hover:bg-rm-bg-hover hover:text-rm-text">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {tab === "activities" && (
            <div className="p-4">
              <button
                onClick={startWordle}
                className="flex w-full items-center gap-4 rounded-lg border border-rm-border bg-rm-bg-surface p-4 text-left hover:bg-rm-bg-hover"
              >
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-white">
                  <WordleLogo />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-black text-rm-text">Daily Wordle</div>
                  <div className="mt-1 text-xs leading-5 text-rm-text-muted">
                    Play the shared daily puzzle in the voice stage with group progress and streaks.
                  </div>
                </div>
              </button>
              {participants.length > 1 && (
                <div className="mt-3 text-xs text-rm-text-muted">
                  {participants.length} people are in this voice session.
                </div>
              )}
            </div>
          )}

          {tab === "soundboard" && (
            <div className="space-y-4 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <label className="flex flex-1 items-center gap-2 rounded-md bg-rm-bg-surface px-3 py-2 text-[11px] font-bold text-rm-text-muted border border-rm-border">
                  <Volume2 size={14} className="text-primary" />
                  <span className="whitespace-nowrap">Send Volume</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round(sendVolume * 100)}
                    onChange={(event) => setSendVolume(Number(event.currentTarget.value) / 100)}
                    className="h-1.5 min-w-0 flex-1 accent-primary"
                  />
                  <span className="w-8 text-right tabular-nums text-rm-text">{Math.round(sendVolume * 100)}%</span>
                </label>
                
                <label className="flex flex-1 items-center gap-2 rounded-md bg-rm-bg-surface px-3 py-2 text-[11px] font-bold text-rm-text-muted border border-rm-border" title="Note: currently playback volume is handled per-sound once started">
                  <Volume2 size={14} className="text-rm-text" />
                  <span className="whitespace-nowrap">Global Volume</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round(playbackVolume * 100)}
                    onChange={(event) => setPlaybackVolume(Number(event.currentTarget.value) / 100)}
                    className="h-1.5 min-w-0 flex-1 accent-primary"
                  />
                  <span className="w-8 text-right tabular-nums text-rm-text">{Math.round(playbackVolume * 100)}%</span>
                </label>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {DEFAULT_SOUNDBOARD_SOUNDS.map((sound) => (
                  <button
                    key={sound.id}
                    onClick={() => broadcastSound(sound)}
                    className="group relative flex items-center gap-2 rounded-md bg-rm-bg-surface px-3 py-2 text-left text-xs font-bold text-rm-text hover:bg-rm-bg-hover border border-transparent hover:border-rm-border transition-all"
                  >
                    <Radio size={14} className="text-primary" /> {sound.name}
                  </button>
                ))}
                {visibleSounds.map((sound) => (
                  <button
                    key={sound.id}
                    onClick={() => broadcastSound({ id: sound.id, name: sound.name, dataUrl: sound.dataUrl, mediaUrl: sound.mediaUrl })}
                    className="group relative flex items-center gap-2 rounded-md bg-rm-bg-surface px-3 py-2 text-left text-xs font-bold text-rm-text hover:bg-rm-bg-hover border border-transparent hover:border-rm-border transition-all overflow-hidden"
                  >
                    <Volume2 size={14} className="text-rm-text-muted shrink-0" /> <span className="truncate flex-1 pr-6">{sound.name}</span>
                    <div 
                      className="absolute right-2 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center p-1 rounded-sm hover:bg-red-500/20 text-red-400"
                      onClick={(e) => handleDeleteSound(sound.id, e)}
                    >
                      <Trash2 size={12} />
                    </div>
                  </button>
                ))}
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*"
                hidden
                onChange={handleFileChange}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-rm-border px-3 py-4 text-xs font-bold text-rm-text-muted hover:bg-rm-bg-surface hover:text-rm-text disabled:cursor-wait disabled:opacity-60 transition-all"
              >
                {isUploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />} {uploadLabel}
              </button>
              <div className="text-center text-[10px] uppercase tracking-widest text-rm-text-muted/60">
                Unlimited sounds, max 50 MB each
              </div>
              {uploadError && (
                <div className="rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-[11px] font-medium text-red-300">
                  {uploadError}
                </div>
              )}
            </div>
          )}

          {tab === "myinstants" && (
            <div className="flex flex-col h-full">
              <div className="sticky top-0 z-10 bg-rm-bg-elevated p-4 border-b border-rm-border flex gap-2">
                <div className="relative flex-1">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-rm-text-muted" />
                  <input 
                    type="text"
                    placeholder="Search millions of sounds..."
                    value={myInstantsQuery}
                    onChange={(e) => setMyInstantsQuery(e.target.value)}
                    className="w-full bg-rm-bg-surface border border-rm-border rounded-lg pl-9 pr-4 py-2 text-xs text-rm-text focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
              </div>
              
              <div className="p-4 flex-1 overflow-y-auto">
                {!myInstantsQuery && myInstantsFavorites.length > 0 && (
                  <div className="mb-6">
                    <div className="mb-3 flex items-center gap-2 text-xs font-bold text-rm-text-muted uppercase tracking-wider">
                      <Star size={12} className="fill-current" /> Favorites
                    </div>
                    <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
                      {myInstantsFavorites.map((sound) => {
                        const isFav = true;
                        return (
                          <button
                            key={`fav-${sound.id}`}
                            style={{ backgroundColor: sound.color }}
                            onClick={() => broadcastSound({ id: sound.id, name: sound.title, mediaUrl: sound.url })}
                            className="group relative flex aspect-square flex-col items-center justify-center rounded-2xl shadow-[0_4px_0_rgba(0,0,0,0.3)] hover:translate-y-[2px] hover:shadow-[0_2px_0_rgba(0,0,0,0.3)] active:shadow-none active:translate-y-[4px] transition-all p-2 overflow-hidden"
                          >
                            <div className="absolute inset-1 rounded-full border-4 border-white/20 shadow-inner mix-blend-overlay pointer-events-none" />
                            
                            <div 
                              className={`absolute top-1.5 right-1.5 z-20 hover:scale-110 active:scale-95 transition-all ${isFav ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                              onClick={(e) => toggleMyInstantsFavorite(sound, e)}
                            >
                              <Star size={14} className={isFav ? "fill-yellow-400 text-yellow-400 drop-shadow-md" : "text-white/80 hover:text-white drop-shadow-md"} />
                            </div>

                            <span className="z-10 mt-auto bg-black/60 px-1.5 py-0.5 text-[10px] leading-tight font-bold text-white rounded text-center w-full shadow-sm">
                              <span className="line-clamp-2">{sound.title}</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

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
                    <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
                      {myInstantsResults.map((sound) => {
                        const isFav = myInstantsFavorites.some(f => f.id === sound.id);
                        return (
                          <button
                            key={sound.id}
                            style={{ backgroundColor: sound.color }}
                            onClick={() => broadcastSound({ id: sound.id, name: sound.title, mediaUrl: sound.url })}
                            className="group relative flex aspect-square flex-col items-center justify-center rounded-2xl shadow-[0_4px_0_rgba(0,0,0,0.3)] hover:translate-y-[2px] hover:shadow-[0_2px_0_rgba(0,0,0,0.3)] active:shadow-none active:translate-y-[4px] transition-all p-2 overflow-hidden"
                          >
                            <div className="absolute inset-1 rounded-full border-4 border-white/20 shadow-inner mix-blend-overlay pointer-events-none" />
                            
                            <div 
                              className={`absolute top-1.5 right-1.5 z-20 hover:scale-110 active:scale-95 transition-all ${isFav ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                              onClick={(e) => toggleMyInstantsFavorite(sound, e)}
                            >
                              <Star size={14} className={isFav ? "fill-yellow-400 text-yellow-400 drop-shadow-md" : "text-white/80 hover:text-white drop-shadow-md"} />
                            </div>

                            <span className="z-10 mt-auto bg-black/60 px-1.5 py-0.5 text-[10px] leading-tight font-bold text-white rounded text-center w-full shadow-sm">
                              <span className="line-clamp-2">{sound.title}</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
              
              <div className="p-3 text-center border-t border-rm-border bg-rm-bg-surface/30">
                <a href="https://www.myinstants.com/" target="_blank" rel="noreferrer" className="text-[10px] font-bold text-rm-text-muted hover:text-rm-text inline-flex items-center gap-1">
                  ⚡ Powered by MyInstants
                </a>
              </div>
            </div>
          )}
        </div>

        {tab === "soundboard" && (
          <div className="shrink-0 border-t border-rm-border bg-rm-bg-surface p-3 transition-all">
            <div className="mb-2 text-[10px] font-black uppercase tracking-widest text-rm-text-muted flex items-center justify-between">
              <span>Now Playing</span>
              <span className="text-rm-text-muted/50 font-normal">{allServerPlaybacks.length} active</span>
            </div>
            <div className="space-y-2 max-h-32 overflow-y-auto pr-1 custom-scrollbar">
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
                <div className="text-center py-3 text-xs text-rm-text-muted italic border border-dashed border-rm-border/50 rounded-md">
                  Quietness fills the room...
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
