import { Button } from "@/components/ui/button";
import { describeApiError } from "@/lib/api-errors";
import { IconButton } from "@/components/ui/IconButton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { RowError } from "@/components/chat/settings/primitives";
import { apiPatch } from "@/lib/api-client";
import type { Channel } from "@/lib/types";
import {
  MAX_VOICE_CHANNEL_STATUS_TEXT,
  normalizeVoiceChannelStatusText,
} from "@/lib/voice-channel-status";
import { useChatActions } from "@/stores/chat-store";
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
      setError(describeApiError(err, "save the channel status"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(nextOpen) => !nextOpen && onClose()}
    >
      <ResponsiveDialogContent className="md:max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>
            What are we chatting about?
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Let others know what you&apos;re up to in the voice channel.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <div className="flex flex-col gap-2">
          <Label htmlFor="voice-channel-status-text">Status</Label>

          <div className="relative">
            <Input
              id="voice-channel-status-text"
              value={text}
              onChange={(event) =>
                setText(
                  event.target.value.slice(0, MAX_VOICE_CHANNEL_STATUS_TEXT),
                )
              }
              placeholder={`Status for ${channel.name}`}
              className="h-11 pr-12"
              maxLength={MAX_VOICE_CHANNEL_STATUS_TEXT}
            />
            <IconButton
              ref={emojiBtnRef}
              icon="emoji"
              iconSize="sm"
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
                  (current + emoji).slice(0, MAX_VOICE_CHANNEL_STATUS_TEXT),
                );
                setShowEmojiPicker(false);
              }}
              onClose={() => setShowEmojiPicker(false)}
              markerRef={emojiBtnRef}
            />
          </div>

          <div className="flex items-center justify-between gap-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setText("")}
              className="-ml-2 text-rm-text-secondary"
            >
              Clear
            </Button>
            <span className="text-ui-2xs font-semibold tabular-nums text-rm-text-muted">
              {normalizedText.length} / {MAX_VOICE_CHANNEL_STATUS_TEXT}
            </span>
          </div>

          {error ? <RowError>{error}</RowError> : null}
        </div>

        <ResponsiveDialogFooter>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={!hasChanges || saving}
            loading={saving}
          >
            Set status
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
