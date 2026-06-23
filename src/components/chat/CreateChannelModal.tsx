
import { BaseModal } from "@/components/ui/BaseModal";
import { cn } from "@/lib/utils";
import { sanitizeChannelName } from "@/lib/validations";
import { useChatActions } from "@/stores/chat-store";
import { useCallback, useEffect, useRef, useState } from "react";
import { Hash, Loader2, Volume2, X } from "./Icons";
interface Props {
  serverId: string;
  defaultCategoryId?: string | null;
  onClose: () => void;
  isClosing?: boolean;
}

export default function CreateChannelModal({ serverId, defaultCategoryId, onClose, isClosing }: Props) {
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
      defaultCategoryId || undefined
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
  }, [name, creating, createChannel, serverId, type, defaultCategoryId, dispatch, onClose]);

  return (
    <BaseModal onClose={onClose}>
      <div className="fixed inset-0 z-200 flex items-center justify-center p-4">
        {/* Backdrop */}
        <div
          className={cn("absolute inset-0 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300", isClosing && "animate-out fade-out")}
          onClick={onClose}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onClose(); }}
          role="button"
          tabIndex={-1}
          aria-hidden="true"
        />

        {/* Modal */}
        <div className={cn("relative z-10 w-full max-w-md animate-in fade-in zoom-in-95 rounded-2xl border border-rm-border bg-rm-bg-primary p-6 shadow-2xl duration-200", isClosing && "animate-out fade-out zoom-out-95")}>
          {/* Close */}
          <button
            onClick={onClose}
            className="absolute right-4 top-4 rounded-lg p-1.5 text-rm-text-muted/40 transition-colors hover:text-rm-text outline-none"
          >
            <X size={20} />
          </button>

          <h2 className="mb-1 text-center text-xl font-bold text-rm-text flex items-center justify-center gap-2">
            {type === "text" ? <Hash className="text-rm-text/40" /> : <Volume2 className="text-rm-text/40" />}
            Create Channel
          </h2>
          <p className="mb-6 text-center text-sm font-medium text-rm-text-muted">
            in {type === "text" ? "Text Channels" : "Voice Channels"}
          </p>

          <div className="space-y-6">
            {/* Channel Type Selection */}
            <div className="space-y-1.5">
              <span id="channel-type-label" className="text-[11px] font-bold uppercase tracking-widest text-rm-text-muted/40 px-1">
                Channel Type
              </span>
              <div className="space-y-2" role="radiogroup" aria-labelledby="channel-type-label">
                <div
                  className={cn(
                    "flex items-center gap-4 p-3 rounded-xl border cursor-pointer transition-all group outline-none focus:ring-2 focus:ring-primary/20",
                    type === "text" ? "bg-rm-bg-active border-primary/50" : "border-rm-border bg-rm-bg-surface/40 hover:bg-rm-bg-hover"
                  )}
                  onClick={() => setType("text")}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setType("text"); }}
                  role="radio"
                  aria-checked={type === "text"}
                  tabIndex={0}
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <Hash size={24} className="text-primary group-hover:scale-110 transition-transform" />
                  </div>
                  <div className="flex-1">
                    <div className="text-rm-text font-semibold">Text</div>
                    <div className="text-rm-text-muted text-xs">Send messages, images, GIFs, and more.</div>
                  </div>
                  <div className={cn(
                    "ml-auto w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all",
                    type === "text" ? "border-primary" : "border-rm-border group-hover:border-rm-text-muted/20"
                  )}>
                    {type === "text" && <div className="w-2.5 h-2.5 bg-primary rounded-full" />}
                  </div>
                </div>

                <div
                  className={cn(
                    "flex items-center gap-4 p-3 rounded-xl border cursor-pointer transition-all group outline-none focus:ring-2 focus:ring-primary/20",
                    type === "voice" ? "bg-rm-bg-active border-primary/50" : "border-rm-border bg-rm-bg-surface/40 hover:bg-rm-bg-hover"
                  )}
                  onClick={() => setType("voice")}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setType("voice"); }}
                  role="radio"
                  aria-checked={type === "voice"}
                  tabIndex={0}
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <Volume2 size={24} className="text-primary group-hover:scale-110 transition-transform" />
                  </div>
                  <div className="flex-1">
                    <div className="text-rm-text font-semibold">Voice</div>
                    <div className="text-rm-text-muted text-xs">Hang out with voice, video, and screen share.</div>
                  </div>
                  <div className={cn(
                    "ml-auto w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all",
                    type === "voice" ? "border-primary" : "border-rm-border group-hover:border-rm-text-muted/20"
                  )}>
                    {type === "voice" && <div className="w-2.5 h-2.5 bg-primary rounded-full" />}
                  </div>
                </div>
              </div>
            </div>

            {/* Channel Name */}
            <div className="space-y-1.5">
              <label htmlFor="channel-name" className="text-[11px] font-bold uppercase tracking-widest text-rm-text-muted/40 px-1">
                Channel Name
              </label>
              <div className="relative">
                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-rm-text-muted/40">
                  {type === "text" ? <Hash size={16} /> : <Volume2 size={16} />}
                </div>
                <input
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
                  className="w-full rounded-xl border border-rm-border bg-rm-bg-surface pl-10 pr-4 py-3 text-rm-text outline-none transition-all placeholder:text-rm-text-muted/20 focus:border-primary/30 focus:ring-2 focus:ring-primary/20"
                />
              </div>
              {error && <p className="mt-1 text-xs font-semibold text-destructive">{error}</p>}
            </div>
          </div>

          <div className="mt-8 flex justify-end gap-3">
            <button
              onClick={onClose}
              className="rounded-xl px-4 py-2.5 text-sm font-medium text-rm-text-muted/60 transition-colors hover:text-rm-text outline-none"
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={!name.trim() || creating}
              className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition-all hover:brightness-110 disabled:opacity-40"
            >
              {creating && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {creating ? "Creating…" : "Create Channel"}
            </button>
          </div>
        </div>
      </div>
    </BaseModal>
  );
}
