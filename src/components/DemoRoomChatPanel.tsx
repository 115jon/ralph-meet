import GifPickerModal from "@/components/chat/GifPickerModal";
import InlineEmojiText from "@/components/chat/InlineEmojiText";
import { GifProviderBranding } from "@/components/chat/GifProviderBranding";
import {
  DEMO_CHAT_MAX_CONTENT_LENGTH,
  DEMO_CHAT_TTL_MINUTES,
  getDemoChatCharacterCounter,
} from "@/lib/demo-chat-limits";
import type { GifPickerItem, GifProvider } from "@/lib/gif-picker";
import type { SFUClient } from "@/lib/sfu-client";
import {
  useClientDateFormatter,
  type ClientDateFormatter,
} from "@/lib/client-date-format";
import { cn } from "@/lib/utils";
import { Dialog, DialogPortal, DialogSurface } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { useCallback, useEffect, useRef, useState } from "react";

interface DemoChatGif {
  url: string;
  content_type: GifPickerItem["send"]["contentType"];
  title?: string;
  source_url?: string;
  provider?: GifProvider;
  width?: number;
  height?: number;
}

interface DemoChatMessage {
  id: string;
  participant_id: string;
  author_name: string;
  content: string;
  gif?: DemoChatGif;
  created_at: number | null;
  expires_at: number | null;
}

interface DemoRoomChatPanelProps {
  sfu: SFUClient | null;
  guestName: string;
  className?: string;
  onUploadBlocked: () => void;
}

interface DemoUploadBlockerModalProps {
  open: boolean;
  onClose: () => void;
  onSignIn: () => void;
}

const DEMO_GIF_PROVIDERS: GifProvider[] = ["klipy", "tenor"];

export function DemoRoomChatPanel({
  sfu,
  guestName,
  className,
  onUploadBlocked,
}: DemoRoomChatPanelProps) {
  const [messages, setMessages] = useState<DemoChatMessage[]>([]);
  const [value, setValue] = useState("");
  const [showGifPicker, setShowGifPicker] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const formatDate = useClientDateFormatter();
  const characterCounter = getDemoChatCharacterCounter(value);

  // `sfu.on(...)` returns the unsubscribe function from EventEmitter.on.
  // react-doctor-disable-next-line react-doctor/effect-needs-cleanup
  useEffect(() => {
    if (!sfu) return;

    const off = sfu.on("app-event", (event) => {
      if (event.type === "demo.chat.history" && Array.isArray(event.messages)) {
        setMessages(
          event.messages.flatMap((message) => {
            const parsedMessage = parseDemoChatMessage(message);
            return parsedMessage ? [parsedMessage] : [];
          }),
        );
        return;
      }

      if (event.type === "demo.chat.message") {
        const message = parseDemoChatMessage(event.message);
        if (!message) return;
        setMessages((current) =>
          [...current.filter((item) => item.id !== message.id), message].slice(
            -75,
          ),
        );
      }
    });

    sfu.requestDemoChatHistory();
    return off;
  }, [sfu]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages.length]);

  const sendMessage = useCallback(
    (content: string, gif?: DemoChatGif) => {
      const trimmed = content.trim();
      if (!sfu || (!trimmed && !gif)) return;

      sfu.sendDemoChatMessage({
        author_name: guestName,
        content: trimmed,
        ...(gif ? { gif } : {}),
      });
    },
    [guestName, sfu],
  );

  const handleSubmit = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      sendMessage(value);
      setValue("");
    },
    [sendMessage, value],
  );

  const handleGifSelect = useCallback(
    async (gif: GifPickerItem) => {
      sendMessage("", {
        url: gif.send.url,
        content_type: gif.send.contentType,
        title: gif.title,
        source_url: gif.sourceUrl,
        provider: gif.provider,
        width: gif.send.width,
        height: gif.send.height,
      });
      setShowGifPicker(false);
    },
    [sendMessage],
  );

  const handlePaste = useCallback(
    (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      if (event.clipboardData.files.length === 0) return;
      event.preventDefault();
      onUploadBlocked();
    },
    [onUploadBlocked],
  );

  return (
    <aside
      className={cn(
        "flex min-h-0 flex-col border-t border-rm-border bg-rm-bg-surface/95 backdrop-blur md:w-[380px] md:border-l md:border-t-0",
        className,
      )}
    >
      <div className="border-b border-rm-border px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-rm-accent-dim text-rm-accent ring-1 ring-rm-accent/20">
              <Icon name="chat" size="sm" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-rm-text">Temporary Chat</h2>
              <p className="text-ui-2xs font-medium text-rm-text-muted">
                Messages and GIFs expire after {DEMO_CHAT_TTL_MINUTES} minutes.
              </p>
            </div>
          </div>
          <Icon
            name="sparkle"
            size="sm"
            className="text-rm-accent opacity-80"
          />
        </div>
      </div>

      <div
        ref={scrollRef}
        className="custom-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4"
      >
        {messages.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-rm-border bg-rm-bg-primary/40 p-4 text-center">
            <p className="text-sm font-semibold text-rm-text">
              No messages yet
            </p>
            <p className="mt-1 text-xs text-rm-text-muted">
              Say hi before this room forgets the conversation in{" "}
              {DEMO_CHAT_TTL_MINUTES} minutes.
            </p>
          </div>
        ) : (
          messages.map((message) => (
            <article
              key={message.id}
              className="group rounded-2xl bg-rm-bg-primary/55 p-3 ring-1 ring-white/5"
            >
              <div className="mb-1 flex items-center justify-between gap-3">
                <span className="truncate text-xs font-bold text-rm-text">
                  <InlineEmojiText text={message.author_name} />
                </span>
                <time
                  className="shrink-0 text-ui-2xs font-medium text-rm-text-muted"
                  dateTime={formatDateTimeAttribute(message.created_at)}
                >
                  {formatChatTime(message.created_at, formatDate)}
                </time>
              </div>
              {message.content && (
                <p className="whitespace-pre-wrap wrap-break-word text-sm leading-relaxed text-rm-text/90">
                  <InlineEmojiText text={message.content} />
                </p>
              )}
              {message.gif && <DemoChatGifPreview gif={message.gif} />}
            </article>
          ))
        )}
      </div>

      <form
        onSubmit={handleSubmit}
        className="relative border-t border-rm-border p-3"
      >
        <div className="mb-2 flex items-center gap-2 rounded-xl border border-amber-500/25 dark:border-amber-400/20 bg-amber-500/5 dark:bg-amber-400/10 px-3 py-2 text-ui-2xs font-semibold text-amber-800 dark:text-amber-100/90">
          <Icon name="lock" size="sm" className="shrink-0" />
          Messages and GIFs here are demo-only and expire after{" "}
          {DEMO_CHAT_TTL_MINUTES} minutes.
        </div>
        <div className="flex items-end gap-2 rounded-2xl bg-rm-bg-primary p-2 ring-1 ring-white/5">
          <button
            type="button"
            onClick={onUploadBlocked}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-rm-text-muted transition hover:bg-rm-bg-hover hover:text-rm-text"
            title="Uploads are in the full app"
            aria-label="Uploads are in the full app"
          >
            <Icon name="image" size="sm" />
          </button>
          <textarea
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onPaste={handlePaste}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                sendMessage(value);
                setValue("");
              }
            }}
            rows={1}
            maxLength={DEMO_CHAT_MAX_CONTENT_LENGTH}
            aria-label="Message this demo room"
            placeholder="Message this room"
            className="custom-scrollbar max-h-28 min-h-9 flex-1 resize-none bg-transparent px-1 py-2 text-sm font-medium text-rm-text outline-none placeholder:text-rm-text-muted/55"
          />
          <button
            type="button"
            onClick={() => setShowGifPicker((current) => !current)}
            className="flex h-9 shrink-0 items-center justify-center rounded-xl px-2 text-xs font-bold tracking-wide text-rm-text-muted transition hover:bg-rm-bg-hover hover:text-primary"
          >
            GIF
          </button>
          <button
            type="submit"
            disabled={!value.trim()}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Send message"
          >
            <Icon name="send" size="sm" />
          </button>
        </div>
        <div className="mt-1 flex justify-end px-2 text-ui-2xs font-semibold text-rm-text-muted/70">
          {characterCounter.label}
        </div>
        <GifPickerModal
          open={showGifPicker}
          onClose={() => setShowGifPicker(false)}
          onSelect={handleGifSelect}
          apiQuery="demo=1"
          defaultProvider="klipy"
          providers={DEMO_GIF_PROVIDERS}
          skipAuth
        />
      </form>
    </aside>
  );
}

export function DemoUploadBlockerModal({
  open,
  onClose,
  onSignIn,
}: DemoUploadBlockerModalProps) {
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogPortal>
        <DialogSurface
          showCloseButton={false}
          className="fixed inset-0 z-50 m-0 flex items-center justify-center border-0 bg-black/65 p-4 backdrop-blur-sm"
          aria-labelledby="demo-upload-blocker-title"
        >
          <div className="w-full max-w-md overflow-hidden rounded-3xl border border-rm-border bg-rm-bg-elevated shadow-2xl">
            <div className="bg-linear-to-br from-primary/15 via-rm-accent/10 to-transparent px-6 pt-6">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/15 text-primary ring-1 ring-primary/25">
                <Icon name="lock" size="lg" />
              </div>
              <h2
                id="demo-upload-blocker-title"
                className="text-xl font-semibold text-rm-text"
              >
                Uploads are in the full app
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-rm-text-muted">
                Sign in to Ralph Meet to upload images and files with persistent
                chat, attachment storage, and the full server experience.
              </p>
            </div>
            <div className="space-y-3 px-6 py-5">
              <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100/90">
                You can try out our GIF implementation for a limited time.
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={onSignIn}
                  className="flex-1 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground transition hover:brightness-110"
                >
                  Sign in for uploads
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 rounded-xl border border-rm-border bg-rm-bg-surface px-4 py-2.5 text-sm font-bold text-rm-text-muted transition hover:bg-rm-bg-hover hover:text-rm-text"
                >
                  Stay in demo
                </button>
              </div>
            </div>
          </div>
        </DialogSurface>
      </DialogPortal>
    </Dialog>
  );
}

function DemoChatGifPreview({ gif }: { gif: DemoChatGif }) {
  const alt = gif.title || "Selected GIF";

  return (
    <a
      href={gif.source_url || gif.url}
      target="_blank"
      rel="noreferrer"
      className="relative mt-2 block overflow-hidden rounded-xl border border-rm-border bg-black/20"
    >
      {gif.content_type === "video/mp4" ? (
        <video
          src={gif.url}
          autoPlay
          loop
          muted
          playsInline
          className="max-h-52 w-full object-cover"
          aria-label={alt}
        />
      ) : (
        <img
          src={gif.url}
          alt={alt}
          className="max-h-52 w-full object-cover"
          loading="lazy"
        />
      )}
      <GifProviderBranding fileKeyOrUrl={gif.source_url || gif.url} />
    </a>
  );
}

function normalizeDemoTimestamp(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== "string" || value.trim() === "") return null;

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function parseDemoChatMessage(value: unknown): DemoChatMessage | null {
  if (!value || typeof value !== "object") return null;
  const message = value as Record<string, unknown>;
  if (typeof message.id !== "string") return null;
  if (typeof message.participant_id !== "string") return null;
  if (typeof message.author_name !== "string") return null;
  if (typeof message.content !== "string") return null;

  const gif = parseDemoChatGif(message.gif);
  return {
    id: message.id,
    participant_id: message.participant_id,
    author_name: message.author_name,
    content: message.content,
    ...(gif ? { gif } : {}),
    created_at: normalizeDemoTimestamp(message.created_at),
    expires_at: normalizeDemoTimestamp(message.expires_at),
  };
}

function parseDemoChatGif(value: unknown): DemoChatGif | undefined {
  if (!value || typeof value !== "object") return undefined;
  const gif = value as Record<string, unknown>;
  if (typeof gif.url !== "string") return undefined;
  if (
    gif.content_type !== "image/gif" &&
    gif.content_type !== "image/apng" &&
    gif.content_type !== "image/webp" &&
    gif.content_type !== "image/png" &&
    gif.content_type !== "video/mp4"
  ) {
    return undefined;
  }

  return {
    url: gif.url,
    content_type: gif.content_type,
    ...(typeof gif.title === "string" ? { title: gif.title } : {}),
    ...(typeof gif.source_url === "string"
      ? { source_url: gif.source_url }
      : {}),
    ...(gif.provider === "klipy" ||
    gif.provider === "tenor" ||
    gif.provider === "external"
      ? { provider: gif.provider }
      : {}),
    ...(typeof gif.width === "number" ? { width: gif.width } : {}),
    ...(typeof gif.height === "number" ? { height: gif.height } : {}),
  };
}

function formatDateTimeAttribute(timestamp: number | null): string | undefined {
  if (timestamp === null) return undefined;
  const date = new Date(timestamp);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function formatChatTime(
  timestamp: number | null,
  formatDate: ClientDateFormatter,
): string {
  return formatDate(timestamp ?? Number.NaN, {
    hour: "2-digit",
    minute: "2-digit",
  });
}
