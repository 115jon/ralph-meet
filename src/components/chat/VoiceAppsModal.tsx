import type { SFUClient } from "@/lib/sfu-client";
import { apiUpload } from "@/lib/api-client";
import {
  DEFAULT_SOUNDBOARD_SOUNDS,
  MAX_CUSTOM_SOUNDBOARD_SOUNDS,
  MAX_SOUNDBOARD_UPLOAD_BYTES,
  getSoundboardServerKey,
  stopSoundboardPlayback,
} from "@/lib/voice/soundboard";
import { cn } from "@/lib/utils";
import { useVoiceActivityStore } from "@/stores/useVoiceActivityStore";
import { useVoiceSoundboardStore } from "@/stores/useVoiceSoundboardStore";
import { Loader2, Pause, Radio, Upload, Volume2, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";

type Tab = "activities" | "soundboard";

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

function isSoundboardAudioFile(file: File) {
  if (file.type.startsWith("audio/")) return true;
  return /\.(aac|flac|m4a|mp3|oga|ogg|opus|wav|weba)$/i.test(file.name);
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

function readStoredSounds(key: string): CustomSound[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(key) || "[]");
  } catch {
    return [];
  }
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
  const [tab, setTab] = useState<Tab>(() => initialTab);
  const serverKey = getSoundboardServerKey(serverId);
  const storageKey = `voice-soundboard:${serverKey}`;
  const [customSounds, setCustomSounds] = useState<CustomSound[]>(() => readStoredSounds(storageKey));
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const setUserActivity = useVoiceActivityStore((s) => s.setUserActivity);
  const activePlaybacks = useVoiceSoundboardStore((s) => s.activePlaybacks);

  const participants = useMemo(() => {
    const byId = new Map<string, { userId: string; name: string }>();
    for (const item of gridItems) {
      if (item.userId) byId.set(item.userId, { userId: item.userId, name: item.name });
    }
    return [...byId.values()];
  }, [gridItems]);

  if (!isOpen) return null;

  const localActivePlaybacks = Object.values(activePlaybacks)
    .filter((playback) => playback.serverKey === serverKey && playback.ownerId === localUserId)
    .sort((a, b) => b.startedAt - a.startedAt);

  const persistSounds = (next: CustomSound[]) => {
    setCustomSounds(next);
    localStorage.setItem(storageKey, JSON.stringify(next));
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
    });
  };

  const startWordle = () => {
    if (!localUserId || !channelId) return;
    const presence = { userId: localUserId, channelId, activity: "wordle" as const, startedAt: Date.now() };
    setUserActivity(presence);
    sfu?.voiceGW.sendAppEvent({ type: "activity.start", ...presence });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm">
      <div className="w-full max-w-xl overflow-hidden rounded-xl border border-rm-border bg-rm-bg-elevated shadow-2xl">
        <div className="flex items-center justify-between border-b border-rm-border px-4 py-3">
          <div className="flex items-center gap-2">
            {(["activities", "soundboard"] as Tab[]).map((value) => (
              <button
                key={value}
                onClick={() => setTab(value)}
                className={cn("rounded-lg px-3 py-1.5 text-xs font-bold capitalize", tab === value ? "bg-primary text-primary-foreground" : "text-rm-text-muted hover:bg-rm-bg-hover hover:text-rm-text")}
              >
                {value}
              </button>
            ))}
          </div>
          <button onClick={onClose} className="rounded-md p-1.5 text-rm-text-muted hover:bg-rm-bg-hover hover:text-rm-text">
            <X size={18} />
          </button>
        </div>

        {tab === "activities" ? (
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
        ) : (
          <div className="space-y-3 p-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {DEFAULT_SOUNDBOARD_SOUNDS.map((sound) => (
                <button key={sound.id} onClick={() => broadcastSound(sound)} className="flex items-center gap-2 rounded-md bg-rm-bg-surface px-3 py-2 text-left text-xs font-bold text-rm-text hover:bg-rm-bg-hover">
                  <Radio size={14} /> {sound.name}
                </button>
              ))}
              {customSounds.map((sound) => (
                <button key={sound.id} onClick={() => broadcastSound({ id: sound.id, name: sound.name, dataUrl: sound.dataUrl, mediaUrl: sound.mediaUrl })} className="flex items-center gap-2 rounded-md bg-rm-bg-surface px-3 py-2 text-left text-xs font-bold text-rm-text hover:bg-rm-bg-hover">
                  <Volume2 size={14} /> <span className="truncate">{sound.name}</span>
                </button>
              ))}
            </div>
            {localActivePlaybacks.length > 0 && (
              <div className="rounded-lg border border-rm-border bg-rm-bg-surface p-3">
                <div className="mb-2 text-[11px] font-black uppercase tracking-widest text-rm-text-muted/60">
                  Now Playing
                </div>
                <div className="space-y-2">
                  {localActivePlaybacks.map((playback) => (
                    <button
                      key={playback.playbackId}
                      onClick={() => {
                        stopSoundboardPlayback(playback.playbackId);
                        sfu?.voiceGW.sendAppEvent({
                          type: "soundboard.stop",
                          server_key: serverKey,
                          user_id: localUserId,
                          playback_id: playback.playbackId,
                        });
                      }}
                      className="flex w-full items-center justify-between rounded-md bg-rm-bg-hover px-3 py-2 text-left text-xs font-bold text-rm-text hover:bg-rm-bg-active"
                    >
                      <span className="truncate">{playback.name}</span>
                      <span className="flex items-center gap-1 text-rm-text-muted">
                        <Pause size={12} /> Stop
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*"
              hidden
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                setUploadError(null);
                setIsUploading(true);
                try {
                  if (!channelId) {
                    throw new Error("Join a voice channel before uploading soundboard audio.");
                  }
                  if (!isSoundboardAudioFile(file)) {
                    throw new Error("Only audio files can be uploaded to the soundboard.");
                  }
                  if (customSounds.length >= MAX_CUSTOM_SOUNDBOARD_SOUNDS) {
                    throw new Error(`You can store up to ${MAX_CUSTOM_SOUNDBOARD_SOUNDS} custom sounds per server.`);
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

                  persistSounds([
                    ...customSounds,
                    {
                      id: crypto.randomUUID(),
                      name: file.name.replace(/\.[^.]+$/, ""),
                      mediaUrl: uploaded.file_url,
                    },
                  ]);
                } catch (error) {
                  setUploadError(error instanceof Error ? error.message : "Failed to add soundboard clip.");
                } finally {
                  setIsUploading(false);
                  event.currentTarget.value = "";
                }
              }}
            />
            <button onClick={() => fileInputRef.current?.click()} disabled={isUploading} className="flex w-full items-center justify-center gap-2 rounded-md border border-rm-border px-3 py-2 text-xs font-bold text-rm-text-muted hover:bg-rm-bg-hover hover:text-rm-text disabled:cursor-wait disabled:opacity-60">
              {isUploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Upload server sound
            </button>
            <div className="text-[11px] text-rm-text-muted/70">
              Up to {MAX_CUSTOM_SOUNDBOARD_SOUNDS} sounds per server, 50 MB each, no duration limit.
            </div>
            {uploadError && (
              <div className="rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-[11px] font-medium text-red-300">
                {uploadError}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
