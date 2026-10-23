import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { sanitizeChannelName } from "@/lib/validations";
import { useChatActions } from "@/stores/chat-store";
import { useCallback, useRef, useState } from "react";
import { Icon } from "@/components/ui/icon";
interface Props {
  open: boolean;
  serverId: string;
  defaultCategoryId?: string | null;
  onClose: () => void;
}

export default function CreateChannelModal({
  open,
  serverId,
  defaultCategoryId,
  onClose,
}: Props) {
  const { createChannel, dispatch } = useChatActions();
  const [name, setName] = useState("");
  const [type, setType] = useState<"text" | "voice">("text");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  const handleCreate = useCallback(async () => {
    if (creating) return;

    const finalName = sanitizeChannelName(name, type, true);
    if (!finalName) {
      setError("Name is required");
      return;
    }

    setCreating(true);
    // The createChannel action handles optimistic UI dispatch internally
    const channelPromise = createChannel(
      serverId,
      finalName,
      type,
      defaultCategoryId || undefined,
    );

    // Optimistic UI for immediate navigation (we guess the temp ID will be set by the action)
    // Actually, createChannel doesn't expose the tempId to us.
    // Wait, the action handles the optimistic creation but `createChannel` returns the *real* channel promise.
    // For true optimistic UI on the *client* side of this modal, we can let the Action handle the transition
    // Wait, let's just await the promise and then navigate, or have the modal close immediately.
    // If the modal closes immediately, the optimistic channel appears on the left side but the user isn't navigated to it yet.
    // To navigate to it optimistically, the action itself should technically handle `SET_ACTIVE_CHANNEL` optionally, OR we just wait.
    // Since channel creation is usually fast, and our optimistic UI adds it to the list, we'll wait for the real ID for navigation to avoid race conditions.
    const channel = await channelPromise;
    if (channel) {
      if (type === "text") {
        dispatch({ type: "SET_ACTIVE_CHANNEL", channelId: channel.id });
      }
      onClose();
    }
    setCreating(false);
  }, [
    name,
    creating,
    createChannel,
    serverId,
    type,
    defaultCategoryId,
    dispatch,
    onClose,
  ]);

  const fields = (
    <div className="flex flex-col gap-4">
      {/* Channel type Selection */}
      <fieldset className="flex flex-col gap-2">
        <legend
          id="channel-type-label"
          className="mb-2 text-ui-sm font-medium text-rm-text"
        >
          Channel type
        </legend>
        <div className="space-y-2" aria-labelledby="channel-type-label">
          <label
            className={cn(
              "flex items-center gap-4 p-3 rounded-xl border cursor-pointer transition-ui group outline-none focus:ring-2 focus:ring-primary/20",
              type === "text"
                ? "bg-rm-bg-active border-primary/50"
                : "border-rm-border bg-rm-bg-surface/40 pointer-fine:hover:bg-rm-bg-hover",
            )}
          >
            <input
              type="radio"
              name="channel-type"
              className="sr-only"
              checked={type === "text"}
              onChange={() => setType("text")}
            />
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <Icon
                name="textChannel"
                size="xl"
                className="text-primary transition-transform"
              />
            </div>
            <div className="flex-1">
              <div className="text-rm-text font-semibold">Text</div>
              <div className="text-rm-text-muted text-ui-xs">
                Send messages, images, GIFs, and more.
              </div>
            </div>
            <div
              className={cn(
                "ml-auto w-5 h-5 rounded-full border-2 flex items-center justify-center transition-ui",
                type === "text"
                  ? "border-primary"
                  : "border-rm-border pointer-fine:group-hover:border-rm-text-muted/20",
              )}
            >
              {type === "text" && (
                <div className="w-2.5 h-2.5 bg-primary rounded-full" />
              )}
            </div>
          </label>

          <label
            className={cn(
              "flex items-center gap-4 p-3 rounded-xl border cursor-pointer transition-ui group outline-none focus:ring-2 focus:ring-primary/20",
              type === "voice"
                ? "bg-rm-bg-active border-primary/50"
                : "border-rm-border bg-rm-bg-surface/40 pointer-fine:hover:bg-rm-bg-hover",
            )}
          >
            <input
              type="radio"
              name="channel-type"
              className="sr-only"
              checked={type === "voice"}
              onChange={() => setType("voice")}
            />
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <Icon
                name="voiceChannel"
                size="xl"
                className="text-primary transition-transform"
              />
            </div>
            <div className="flex-1">
              <div className="text-rm-text font-semibold">Voice</div>
              <div className="text-rm-text-muted text-ui-xs">
                Hang out with voice, video, and screen share.
              </div>
            </div>
            <div
              className={cn(
                "ml-auto w-5 h-5 rounded-full border-2 flex items-center justify-center transition-ui",
                type === "voice"
                  ? "border-primary"
                  : "border-rm-border pointer-fine:group-hover:border-rm-text-muted/20",
              )}
            >
              {type === "voice" && (
                <div className="w-2.5 h-2.5 bg-primary rounded-full" />
              )}
            </div>
          </label>
        </div>
      </fieldset>

      {/* Channel name */}
      <div className="flex flex-col gap-2">
        <Label htmlFor="channel-name">Channel name</Label>
        <div className="relative">
          <div className="absolute left-4 top-1/2 -translate-y-1/2 text-rm-text-muted">
            {type === "text" ? (
              <Icon name="textChannel" size="sm" />
            ) : (
              <Icon name="voiceChannel" size="sm" />
            )}
          </div>
          <Input
            id="channel-name"
            ref={inputRef}
            value={name}
            onChange={(e) => {
              const val = e.target.value;
              setName(sanitizeChannelName(val, type));
              setError(null);
            }}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            placeholder={type === "text" ? "new-channel" : "General Voice"}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "channel-name-error" : undefined}
            className="pl-10 max-md:min-h-11"
          />
        </div>
        {error && (
          <p
            id="channel-name-error"
            className="text-ui-xs font-medium text-rm-danger-ink"
          >
            {error}
          </p>
        )}
      </div>
    </div>
  );

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(nextOpen) => !nextOpen && onClose()}
    >
      <ResponsiveDialogContent
        className="md:max-w-md"
        // Desktop only: the drawer keeps focus on its surface so the phone
        // keyboard does not jump up on open.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="flex items-center gap-2">
            <Icon
              name={type === "text" ? "textChannel" : "voiceChannel"}
              size="xl"
              className="text-rm-text-muted"
            />
            Create channel
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            in {type === "text" ? "Text channels" : "Voice channels"}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        {fields}
        <ResponsiveDialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            disabled={!name.trim() || creating}
            loading={creating}
          >
            Create channel
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
