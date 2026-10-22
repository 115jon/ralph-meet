import { Button } from "@/components/ui/button";
import { Dialog, DialogPortal, DialogSurface } from "@/components/ui/dialog";
import { IconButton } from "@/components/ui/IconButton";
import { cn } from "@/lib/utils";
import { apiPatch } from "@/lib/api-client";
import type { Channel } from "@/lib/types";
import {
  MAX_VOICE_CHANNEL_STATUS_TEXT,
  normalizeVoiceChannelStatusText,
} from "@/lib/voice-channel-status";
import { useChatActions } from "@/stores/chat-store";
import { MessageSquareText, Smile, X } from "lucide-react";
import { useEffect, useMemo, useState, useRef } from "react";

import EmojiPicker from "./EmojiPicker";

interface VoiceChannelTextStatusModalProps {
  open: boolean;
  channel: Channel;
  voiceSessionId?: string | null;
  onClose: () => void;
}

export default function VoiceChannelTextStatusModal({
  open,
  channel,
  voiceSessionId = null,
  onClose,
}: VoiceChannelTextStatusModalProps) {
  const { dispatch } = useChatActions();
  const [text, setText] = useState(() => channel.voice_status?.text ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const emojiBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setText(channel.voice_status?.text ?? "");
    setError(null);
    setShowEmojiPicker(false);
  }, [channel.id, channel.voice_status?.text]);

  const initialText = channel.voice_status?.text ?? "";
  const preservedMedia = channel.voice_status?.media ?? null;
  const normalizedText = normalizeVoiceChannelStatusText(text) ?? "";
  const hasChanges = normalizedText !== initialText;
  const voiceSessionHeaders = voiceSessionId
    ? { "X-Voice-Session-Id": voiceSessionId }
    : undefined;

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
      const updatedChannel = await apiPatch<Channel>(
        `/api/channels/${channel.id}/voice-status`,
        {
          voice_status: payload,
        },
        { headers: voiceSessionHeaders },
      );
      dispatch({ type: "UPSERT_CHANNEL", channel: updatedChannel });
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to save channel status",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogPortal>
        <>
          <div
            data-state={open ? "open" : "closed"}
            className={cn(
              "fixed inset-0 z-50 bg-black/50 backdrop-blur-sm duration-200",
              "animate-in fade-in data-[state=closed]:pointer-events-none data-[state=closed]:opacity-0 data-[state=closed]:animate-out data-[state=closed]:fade-out",
            )}
            onClick={onClose}
            aria-hidden="true"
          />
          <div
            data-state={open ? "open" : "closed"}
            className="fixed inset-0 z-60 flex items-center justify-center p-4 data-[state=open]:pointer-events-auto data-[state=closed]:pointer-events-none data-[state=closed]:opacity-0"
          >
            <DialogSurface
              showCloseButton={false}
              className={cn(
                "picker-panel relative m-0 w-full max-w-[540px] rounded-xl border p-0 shadow-[var(--rm-shadow-3)] outline-none backdrop-blur-2xl duration-200",
                "animate-in zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=closed]:zoom-out-95",
              )}
              aria-labelledby="voice-channel-text-status-title"
            >
              <div className="relative rounded-t-xl border-b border-rm-border bg-gradient-to-b from-primary/10 to-transparent px-6 pb-7 pt-6">
                <IconButton
                  icon={X}
                  size="md"
                  shape="circle"
                  type="button"
                  onClick={onClose}
                  className="absolute right-4 top-4"
                  aria-label="Close status editor"
                />

                <div className="mx-auto mb-6 flex h-28 w-28 items-center justify-center rounded-full border border-rm-border bg-rm-bg-surface shadow-[0_18px_40px_rgba(0,0,0,0.22)]">
                  <div className="flex h-20 w-20 items-center justify-center rounded-full bg-rm-bg-hover text-rm-accent-ink">
                    <MessageSquareText className="h-9 w-9" />
                  </div>
                </div>

                <div className="text-center">
                  <h2
                    id="voice-channel-text-status-title"
                    className="text-ui-xl font-semibold text-rm-text"
                  >
                    What are we chatting about?
                  </h2>
                  <p className="mt-2 text-sm text-rm-text-muted sm:text-ui-base">
                    Let others know what you&apos;re up to in the voice channel.
                  </p>
                </div>
              </div>

              <div className="px-6 pb-6 pt-5">
                <label
                  htmlFor="voice-channel-status-text"
                  className="mb-2 block text-sm font-bold text-rm-text"
                >
                  Status
                </label>

                <div className="relative">
                  <input
                    id="voice-channel-status-text"
                    value={text}
                    onChange={(event) =>
                      setText(
                        event.target.value.slice(
                          0,
                          MAX_VOICE_CHANNEL_STATUS_TEXT,
                        ),
                      )
                    }
                    placeholder={`Status for ${channel.name}`}
                    className="picker-search-input h-11 w-full rounded-lg border px-4 pr-12 text-ui-base outline-none transition placeholder:text-rm-text-muted focus:border-primary/60"
                    maxLength={MAX_VOICE_CHANNEL_STATUS_TEXT}
                  />
                  <IconButton
                    ref={emojiBtnRef}
                    icon={Smile}
                    iconSize={16}
                    variant="muted"
                    shape="circle"
                    type="button"
                    aria-label="Insert emoji"
                    onClick={() => setShowEmojiPicker((current) => !current)}
                    className="absolute right-2 top-1/2 -translate-y-1/2"
                  />

                  <EmojiPicker
                    open={showEmojiPicker}
                    placement="top-end"
                    onSelect={(emoji) => {
                      setText((current) =>
                        (current + emoji).slice(
                          0,
                          MAX_VOICE_CHANNEL_STATUS_TEXT,
                        ),
                      );
                      setShowEmojiPicker(false);
                    }}
                    onClose={() => setShowEmojiPicker(false)}
                    markerRef={emojiBtnRef}
                  />
                </div>

                <div className="mt-3 flex items-center justify-between gap-3">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setText("")}
                    className="-ml-2.5 text-rm-text-secondary"
                  >
                    Clear
                  </Button>
                  <span className="text-ui-2xs font-bold text-rm-text-muted">
                    {normalizedText.length} / {MAX_VOICE_CHANNEL_STATUS_TEXT}
                  </span>
                </div>

                {error ? (
                  <div className="mt-4 rounded-2xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                    {error}
                  </div>
                ) : null}
              </div>

              <div className="flex flex-col-reverse gap-2 border-t border-rm-border px-6 py-5 sm:flex-row sm:justify-end">
                <Button type="button" variant="secondary" onClick={onClose}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={handleSave}
                  disabled={!hasChanges || saving}
                  loading={saving}
                >
                  Set Status
                </Button>
              </div>
            </DialogSurface>
          </div>
        </>
      </DialogPortal>
    </Dialog>
  );
}
