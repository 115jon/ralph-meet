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
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { DISABLED, HIT, PRESS } from "@/components/ui/interaction";
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
        "flex min-h-0 flex-col border-t border-line bg-ply-1 md:w-[360px] md:border-t-0 md:border-l",
        className,
      )}
    >
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-4">
        <Icon name="chat" size="lg" className="shrink-0 text-ink-3" />
        <div className="min-w-0">
          <h2 className="truncate text-ui-sm font-semibold text-ink-1">
            Temporary chat
          </h2>
          <p className="truncate text-ui-xs text-ink-3">
            Messages and GIFs expire after {DEMO_CHAT_TTL_MINUTES} minutes.
          </p>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4"
      >
        {messages.length === 0 ? (
          <EmptyState
            size="sm"
            title="No messages yet"
            description={`Say hi. This room forgets the conversation after ${DEMO_CHAT_TTL_MINUTES} minutes.`}
          />
        ) : (
          messages.map((message) => (
            <article key={message.id} className="group">
              <div className="mb-0.5 flex items-baseline gap-2">
                <span className="truncate text-ui-sm font-semibold text-ink-1">
                  <InlineEmojiText text={message.author_name} />
                </span>
                <time
                  className="shrink-0 text-num-xs text-ink-3"
                  dateTime={formatDateTimeAttribute(message.created_at)}
                >
                  {formatChatTime(message.created_at, formatDate)}
                </time>
              </div>
              {message.content && (
                <p className="whitespace-pre-wrap wrap-break-word text-ui-sm text-ink-1">
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
        className="relative border-t border-line p-3"
      >
        <div className="flex items-end gap-1 rounded-lg border border-line bg-ply-2 p-1.5">
          <button
            type="button"
            onClick={onUploadBlocked}
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-md text-ink-3 outline-none pointer-fine:hover:text-ink-1 focus-visible:outline-2 focus-visible:outline-focus",
              PRESS,
              HIT,
            )}
            title="Uploads are in the full app"
            aria-label="Uploads are in the full app"
          >
            <Icon name="image" size="lg" />
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
            className="max-h-28 min-h-8 flex-1 resize-none bg-transparent px-1 py-1.5 text-ui-md text-ink-1 outline-none placeholder:text-ink-3 md:text-ui-base"
          />
          <button
            type="button"
            onClick={() => setShowGifPicker((current) => !current)}
            aria-pressed={showGifPicker}
            aria-label="Open GIF picker"
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-md text-ink-3 outline-none pointer-fine:hover:text-ink-1 focus-visible:outline-2 focus-visible:outline-focus aria-pressed:bg-tint-2 aria-pressed:text-ink-1",
              PRESS,
              HIT,
            )}
          >
            <Icon name="gif" size="lg" />
          </button>
          <button
            type="submit"
            disabled={!value.trim()}
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-md bg-primary-fill text-on-primary outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
              PRESS,
              HIT,
              DISABLED,
            )}
            aria-label="Send message"
          >
            <Icon name="send" size="lg" />
          </button>
        </div>
        <div className="mt-1 flex justify-end px-2 text-num-xs text-ink-3">
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
    <ResponsiveDialog
      open={open}
      onOpenChange={(nextOpen) => !nextOpen && onClose()}
    >
      <ResponsiveDialogContent dialogClassName="md:max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>
            Uploads are in the full app
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Sign in to Ralph Meet to upload images and files, with persistent
            chat and attachment storage. GIFs work here in the demo.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ResponsiveDialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Stay in demo
          </Button>
          <Button onClick={onSignIn}>Sign in to upload</Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

function DemoChatGifPreview({ gif }: { gif: DemoChatGif }) {
  const alt = gif.title || "Selected GIF";

  return (
    <a
      href={gif.source_url || gif.url}
      target="_blank"
      rel="noreferrer"
      className="relative mt-2 block overflow-hidden rounded-md border border-line bg-ply-2"
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
