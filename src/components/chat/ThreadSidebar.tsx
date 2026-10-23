import { Button, Spinner } from "@/components/ui/button";
import { describeApiError } from "@/lib/api-errors";
import { SidePanel, type SidePanelMode } from "@/components/ui/side-panel";
import { apiGet, apiPost } from "@/lib/api-client";
import type { Message } from "@/lib/types";
import { useCallback, useEffect, useRef, useState } from "react";
import MessageItem from "./MessageItem";

interface Props {
  channelId: string;
  rootMessageId: string;
  currentUserId?: string;
  canPin: boolean;
  canDeleteMessages?: boolean;
  onReply: (message: Message) => void;
  onPin: (message: Message) => void;
  onUnpin: (messageId: string, skipConfirm?: boolean) => void;
  onJump: (messageId: string) => void;
  onBan?: (userId: string, username: string) => void;
  onClose: () => void;
  /** False while the panel animates out (the host keeps it mounted). */
  open?: boolean;
  /** Force one panel form (fixtures, tests). */
  forceMode?: SidePanelMode;
}

function _formatDate(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  const time = d.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  if (d.toDateString() === today.toDateString()) return `Today at ${time}`;
  if (d.toDateString() === yesterday.toDateString())
    return `Yesterday at ${time}`;
  return `${d.toLocaleDateString([], { month: "2-digit", day: "2-digit", year: "numeric" })} ${time}`;
}

export default function ThreadSidebar({
  channelId,
  rootMessageId,
  currentUserId,
  canPin,
  canDeleteMessages = false,
  onReply,
  onPin,
  onUnpin,
  onJump,
  onBan,
  onClose,
  open = true,
  forceMode,
}: Props) {
  const [root, setRoot] = useState<Message | null>(null);
  const [replies, setReplies] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const fetchThread = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      if (!silent) setError(null);
      try {
        const data = await apiGet<{ root: Message; replies: Message[] }>(
          `/api/channels/${channelId}/thread?message_id=${rootMessageId}`,
        );
        setRoot(data.root);
        setReplies(data.replies);
      } catch (err: any) {
        if (!silent) setError(describeApiError(err, "load this thread"));
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [channelId, rootMessageId],
  );

  useEffect(() => {
    fetchThread();
  }, [fetchThread]);

  // Auto-scroll to bottom when new replies arrive
  useEffect(() => {
    if (replies.length > 0) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [replies.length]);

  // Listen for new and deleted messages in this channel that are replies to this thread
  useEffect(() => {
    const handler = (e: Event) => {
      try {
        const customEvent = e as CustomEvent<{ event: string; data: any }>;
        const { event, data } = customEvent.detail;

        if (event === "MESSAGE_CREATE" && data?.reply_to_id === rootMessageId) {
          setReplies((prev) => {
            // Deduplicate
            if (prev.some((r) => r.id === data.id)) return prev;
            return [...prev, data as Message];
          });
        } else if (event === "MESSAGE_DELETE") {
          setReplies((prev) => prev.filter((r) => r.id !== data.id));
        }
      } catch {
        /* ignore */
      }
    };

    window.addEventListener("chat-gateway-event", handler);
    // Removed the 10s generic polling interval that caused layout flashes.
    // WebSockets handle the real-time flow.
    return () => {
      window.removeEventListener("chat-gateway-event", handler);
    };
  }, [rootMessageId]);

  const handleSendReply = useCallback(
    async (content: string) => {
      const tempId = `temp-${Date.now()}`;
      const tempMsg: Message = {
        id: tempId,
        channel_id: channelId,
        author_id: currentUserId || "",
        content,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        reply_to_id: rootMessageId,
        is_pinned: false,
        attachments: [],
        author: {
          id: currentUserId || "",
          username: "You",
          image_url: "",
          created_at: new Date().toISOString(),
        } as any,
      };

      // Optimistically add to replies
      setReplies((prev) => [...prev, tempMsg]);

      try {
        const newMsg = await apiPost<Message>(
          `/api/channels/${channelId}/messages`,
          {
            content,
            reply_to_id: rootMessageId,
          },
        );

        // Deduplicate: If WS already inserted the real message, just delete the temp one
        setReplies((prev) => {
          if (prev.some((m) => m.id === newMsg.id && m.id !== tempId)) {
            return prev.filter((m) => m.id !== tempId);
          }
          // Otherwise replace temp message with the actual REST response message
          return prev.map((m) => (m.id === tempId ? newMsg : m));
        });
      } catch (err: any) {
        console.error("Failed to send reply:", err);
        // Revert optimistic add on failure
        setReplies((prev) => prev.filter((m) => m.id !== tempId));
      }
    },
    [channelId, rootMessageId, currentUserId],
  );

  return (
    <SidePanel
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="Thread"
      titleAdornment={
        <span className="shrink-0 text-ui-xs text-rm-text-muted">
          {replies.length} {replies.length === 1 ? "reply" : "replies"}
        </span>
      }
      forceMode={forceMode}
    >
      {/* Thread body */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-4 custom-scrollbar">
        {loading ? (
          <div className="flex h-full items-center justify-center text-rm-text-muted">
            <Spinner className="size-6" />
            <span className="sr-only">Loading</span>
          </div>
        ) : error ? (
          <div
            role="alert"
            className="mx-4 rounded-md bg-rm-danger-tint px-3 py-2 text-ui-sm text-rm-danger-ink"
          >
            {error}
          </div>
        ) : (
          <div className="flex flex-col gap-1 pb-4">
            {/* Root message */}
            {root && (
              <div className="mx-4 mb-2 rounded-lg border border-rm-border bg-rm-bg-surface py-2">
                <MessageItem
                  id={`thread-root-${root.id}`}
                  message={root}
                  showHeader={true}
                  hideReplyConnector={true}
                  currentUserId={currentUserId}
                  canPin={canPin}
                  canDeleteMessages={canDeleteMessages}
                  onReply={onReply}
                  onPin={onPin}
                  onUnpin={onUnpin}
                  onJump={onJump}
                  onBan={onBan}
                />
              </div>
            )}

            {/* Divider */}
            {replies.length > 0 && (
              <div className="my-2 flex items-center gap-2 px-4">
                <div className="h-px flex-1 bg-rm-border" />
                <span className="text-ui-xs font-medium text-rm-text-muted">
                  {replies.length} {replies.length === 1 ? "Reply" : "Replies"}
                </span>
                <div className="h-px flex-1 bg-rm-border" />
              </div>
            )}

            {/* Replies */}
            {replies.map((reply, idx) => {
              // Group messages logically like MessageList
              let showHeader = true;
              if (idx > 0) {
                const prev = replies[idx - 1];
                const hasSameAuthor = prev.author_id === reply.author_id;
                if (hasSameAuthor) {
                  const prevTime = new Date(prev.created_at).getTime();
                  const curTime = new Date(reply.created_at).getTime();
                  showHeader = curTime - prevTime > 5 * 60 * 1000;
                }
              }

              return (
                <div key={reply.id} className="py-0.5">
                  <MessageItem
                    id={`thread-reply-${reply.id}`}
                    message={reply}
                    showHeader={showHeader}
                    hideReplyConnector={true}
                    currentUserId={currentUserId}
                    canPin={canPin}
                    canDeleteMessages={canDeleteMessages}
                    onReply={onReply}
                    onPin={onPin}
                    onUnpin={onUnpin}
                    onJump={onJump}
                    onBan={onBan}
                  />
                </div>
              );
            })}
            <div ref={bottomRef} className="h-2" />
          </div>
        )}
      </div>

      {/* Reply input */}
      <ThreadReplyInput onSend={handleSendReply} />
    </SidePanel>
  );
}

function ThreadReplyInput({
  onSend,
}: {
  onSend: (content: string) => Promise<void>;
}) {
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);

  const handleSubmit = async () => {
    const trimmed = value.trim();
    if (!trimmed || sending) return;
    setSending(true);
    await onSend(trimmed);
    setValue("");
    setSending(false);
  };

  return (
    <div className="shrink-0 border-t border-rm-border px-4 pt-3 pb-[max(12px,var(--safe-area-bottom,0px))] max-md:px-2">
      <div className="flex items-center gap-2 rounded-lg border border-rm-border bg-rm-bg-elevated px-3 py-2 focus-within:border-rm-border-strong">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-label="Reply to thread"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSubmit();
            }
          }}
          placeholder="Reply to thread…"
          className="min-w-0 flex-1 bg-transparent text-ui-base text-rm-text outline-none placeholder:text-rm-text-muted max-md:text-ui-md"
        />
        <Button
          size="sm"
          onClick={handleSubmit}
          disabled={!value.trim()}
          loading={sending}
        >
          Send
        </Button>
      </div>
    </div>
  );
}
