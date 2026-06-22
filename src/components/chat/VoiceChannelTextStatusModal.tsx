import { BaseModal } from "@/components/ui/BaseModal";
import { apiPatch } from "@/lib/api-client";
import type { Channel } from "@/lib/types";
import {
  MAX_VOICE_CHANNEL_STATUS_TEXT,
  normalizeVoiceChannelStatusText,
} from "@/lib/voice-channel-status";
import { useChatActions } from "@/stores/chat-store";
import { Loader2, MessageSquareText, Smile, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import EmojiPicker from "./EmojiPicker";

interface VoiceChannelTextStatusModalProps {
  channel: Channel;
  voiceSessionId?: string | null;
  onClose: () => void;
}

export default function VoiceChannelTextStatusModal({
  channel,
  voiceSessionId = null,
  onClose,
}: VoiceChannelTextStatusModalProps) {
  const { dispatch } = useChatActions();
  const [text, setText] = useState(() => channel.voice_status?.text ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  useEffect(() => {
    setText(channel.voice_status?.text ?? "");
    setError(null);
    setShowEmojiPicker(false);
  }, [channel.id, channel.voice_status?.text]);

  const initialText = channel.voice_status?.text ?? "";
  const preservedMedia = channel.voice_status?.media ?? null;
  const normalizedText = normalizeVoiceChannelStatusText(text) ?? "";
  const hasChanges = normalizedText !== initialText;
  const voiceSessionHeaders = voiceSessionId ? { "X-Voice-Session-Id": voiceSessionId } : undefined;

  const payload = useMemo(() => {
    if (!normalizedText && !preservedMedia) return null;
    return {
      text: normalizedText || null,
      media: preservedMedia,
    };
  }, [normalizedText, preservedMedia]);

  const handleSave = async () => {
    if (!hasChanges || saving) return;
    setSaving(true);
    setError(null);

    try {
      const updatedChannel = await apiPatch<Channel>(`/api/channels/${channel.id}/voice-status`, {
        voice_status: payload,
      }, { headers: voiceSessionHeaders });
      dispatch({ type: "UPSERT_CHANNEL", channel: updatedChannel });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save channel status");
    } finally {
      setSaving(false);
    }
  };

  return (
    <BaseModal onClose={onClose}>
      <>
        <div
          className="fixed inset-0 z-1000 bg-slate-900/40 dark:bg-black/70 backdrop-blur-sm"
          onClick={onClose}
          aria-hidden="true"
        />
        <div className="fixed inset-0 z-1001 flex items-center justify-center p-4">
          <div
            className="w-full max-w-[540px] overflow-hidden rounded-[22px] border border-slate-200 dark:border-white/10 bg-slate-50/95 dark:bg-[#17181c] shadow-2xl backdrop-blur-2xl"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="voice-channel-text-status-title"
          >
            <div className="relative border-b border-slate-200 dark:border-white/6 bg-indigo-50/50 dark:bg-[radial-gradient(circle_at_top,rgba(102,110,255,0.22),transparent_58%),linear-gradient(180deg,#2a1d47_0%,#17181c_88%)] px-6 pb-7 pt-6">
              <button
                type="button"
                onClick={onClose}
                className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full text-rm-text-muted transition-colors hover:bg-slate-200 dark:hover:bg-white/6 hover:text-rm-text"
                aria-label="Close status editor"
              >
                <X className="h-5 w-5" />
              </button>

              <div className="mx-auto mb-6 flex h-28 w-28 items-center justify-center rounded-full border border-slate-200/50 dark:border-white/10 bg-indigo-100/50 dark:bg-black/15 shadow-[0_18px_40px_rgba(0,0,0,0.22)]">
                <div className="flex h-20 w-20 items-center justify-center rounded-full bg-indigo-200/50 dark:bg-white/10 text-indigo-500 dark:text-white">
                  <MessageSquareText className="h-9 w-9" />
                </div>
              </div>

              <div className="text-center">
                <h2 id="voice-channel-text-status-title" className="text-[22px] font-black tracking-tight text-rm-text sm:text-[26px]">
                  What are we chatting about?
                </h2>
                <p className="mt-2 text-sm text-rm-text-muted sm:text-[15px]">
                  Let others know what you&apos;re up to in the voice channel.
                </p>
              </div>
            </div>

            <div className="px-6 pb-6 pt-5">
              <label htmlFor="voice-channel-status-text" className="mb-2 block text-sm font-bold text-rm-text">
                Status
              </label>

              <div className="relative">
                <input
                  id="voice-channel-status-text"
                  value={text}
                  onChange={(event) => setText(event.target.value.slice(0, MAX_VOICE_CHANNEL_STATUS_TEXT))}
                  placeholder={`Status for ${channel.name}`}
                  className="h-11 w-full rounded-[12px] border border-slate-200 dark:border-white/10 bg-slate-100/80 dark:bg-black/20 px-4 pr-12 text-[15px] text-rm-text outline-none transition-colors placeholder:text-slate-500 dark:placeholder:text-rm-text-muted/50 focus:border-primary/60"
                  maxLength={MAX_VOICE_CHANNEL_STATUS_TEXT}
                />
                <button
                  type="button"
                  aria-label="Insert emoji"
                  onClick={() => setShowEmojiPicker((current) => !current)}
                  className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-rm-text-muted transition-colors hover:bg-slate-200 dark:hover:bg-white/6 hover:text-rm-text"
                >
                  <Smile className="h-4 w-4" />
                </button>

                {showEmojiPicker ? (
                  <EmojiPicker
                    placement="bottom-end"
                    onSelect={(emoji) => {
                      setText((current) => (current + emoji).slice(0, MAX_VOICE_CHANNEL_STATUS_TEXT));
                      setShowEmojiPicker(false);
                    }}
                    onClose={() => setShowEmojiPicker(false)}
                  />
                ) : null}
              </div>

              <div className="mt-3 flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setText("")}
                  className="rounded-full px-2 py-1 text-sm font-medium text-rm-text-muted transition-colors hover:text-rm-text"
                >
                  Clear
                </button>
                <span className="text-[11px] font-bold text-rm-text-muted">
                  {normalizedText.length} / {MAX_VOICE_CHANNEL_STATUS_TEXT}
                </span>
              </div>

              {error ? (
                <div className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                  {error}
                </div>
              ) : null}
            </div>

            <div className="grid grid-cols-2 gap-3 border-t border-slate-200 dark:border-white/6 px-6 py-5">
              <button
                type="button"
                onClick={onClose}
                className="h-11 rounded-[10px] bg-slate-200/50 dark:bg-white/7 text-sm font-semibold text-rm-text transition-colors hover:bg-slate-200 dark:hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={!hasChanges || saving}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-[10px] bg-primary text-sm font-semibold text-primary-foreground transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Set Status
              </button>
            </div>
          </div>
        </div>
      </>
    </BaseModal>
  );
}
