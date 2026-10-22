import { Button } from "@/components/ui/button";
import { Dialog, DialogPortal, DialogSurface } from "@/components/ui/dialog";
import { IconButton } from "@/components/ui/IconButton";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { sanitizeChannelName } from "@/lib/validations";
import { useChatActions } from "@/stores/chat-store";
import { useCallback, useEffect, useRef, useState } from "react";
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

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Close on Escape

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

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogPortal>
        <div
          data-state={open ? "open" : "closed"}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 transition-opacity duration-200 data-[state=closed]:pointer-events-none data-[state=closed]:opacity-0"
        >
          {/* Backdrop */}
          <button
            type="button"
            data-base-modal-backdrop
            className={cn(
              "absolute inset-0 border-0 bg-black/60 p-0 backdrop-blur-sm animate-in fade-in duration-300",
              "data-[state=closed]:animate-out data-[state=closed]:fade-out",
            )}
            aria-label="Close create channel modal"
            onClick={onClose}
          />

          {/* Modal */}
          <DialogSurface
            showCloseButton={false}
            className={cn(
              "relative z-10 w-full max-w-md animate-in fade-in zoom-in-95 rounded-xl border border-rm-border bg-rm-bg-surface dark:bg-rm-bg-elevated p-6 shadow-[var(--rm-shadow-3)] duration-200",
              "data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=closed]:zoom-out-95",
            )}
          >
            {/* Close */}
            <IconButton
              icon="close"
              type="button"
              onClick={onClose}
              className="absolute right-4 top-4"
              aria-label="Close create channel modal"
            />

            <h2 className="mb-1 text-center text-ui-lg font-semibold text-rm-text flex items-center justify-center gap-2">
              {type === "text" ? (
                <Icon
                  name="textChannel"
                  size="xl"
                  className="text-rm-text/40"
                />
              ) : (
                <Icon
                  name="voiceChannel"
                  size="xl"
                  className="text-rm-text/40"
                />
              )}
              Create Channel
            </h2>
            <p className="mb-6 text-center text-sm font-medium text-rm-text-muted">
              in {type === "text" ? "Text Channels" : "Voice Channels"}
            </p>

            <div className="space-y-6">
              {/* Channel Type Selection */}
              <fieldset className="space-y-2">
                <legend
                  id="channel-type-label"
                  className="text-ui-2xs font-semibold uppercase tracking-[0.08em] px-1 text-rm-text-muted"
                >
                  Channel Type
                </legend>
                <div className="space-y-2" aria-labelledby="channel-type-label">
                  <label
                    className={cn(
                      "flex items-center gap-4 p-3 rounded-xl border cursor-pointer transition-ui group outline-none focus:ring-2 focus:ring-primary/20",
                      type === "text"
                        ? "bg-rm-bg-active border-primary/50"
                        : "border-rm-border bg-rm-bg-surface/40 hover:bg-rm-bg-hover",
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
                      <div className="text-rm-text-muted text-xs">
                        Send messages, images, GIFs, and more.
                      </div>
                    </div>
                    <div
                      className={cn(
                        "ml-auto w-5 h-5 rounded-full border-2 flex items-center justify-center transition-ui",
                        type === "text"
                          ? "border-primary"
                          : "border-rm-border group-hover:border-rm-text-muted/20",
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
                        : "border-rm-border bg-rm-bg-surface/40 hover:bg-rm-bg-hover",
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
                      <div className="text-rm-text-muted text-xs">
                        Hang out with voice, video, and screen share.
                      </div>
                    </div>
                    <div
                      className={cn(
                        "ml-auto w-5 h-5 rounded-full border-2 flex items-center justify-center transition-ui",
                        type === "voice"
                          ? "border-primary"
                          : "border-rm-border group-hover:border-rm-text-muted/20",
                      )}
                    >
                      {type === "voice" && (
                        <div className="w-2.5 h-2.5 bg-primary rounded-full" />
                      )}
                    </div>
                  </label>
                </div>
              </fieldset>

              {/* Channel Name */}
              <div className="space-y-1.5">
                <label
                  htmlFor="channel-name"
                  className="text-ui-2xs font-semibold uppercase tracking-[0.08em] text-rm-text-muted px-1"
                >
                  Channel Name
                </label>
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
                    placeholder={
                      type === "text" ? "new-channel" : "General Voice"
                    }
                    className="h-10 pl-10"
                  />
                </div>
                {error && (
                  <p className="mt-1 text-xs font-semibold text-destructive">
                    {error}
                  </p>
                )}
              </div>
            </div>

            <div className="mt-8 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button
                onClick={handleCreate}
                disabled={!name.trim() || creating}
                loading={creating}
              >
                Create Channel
              </Button>
            </div>
          </DialogSurface>
        </div>
      </DialogPortal>
    </Dialog>
  );
}
