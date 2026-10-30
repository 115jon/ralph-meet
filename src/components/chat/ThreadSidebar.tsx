import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";
import { Num } from "@/components/ui/num";
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
        loading || error ? null : (
          <span className="shrink-0 text-ui-xs text-ink-3">
            <Num>{replies.length}</Num>{" "}
            {replies.length === 1 ? "reply" : "replies"}
          </span>
        )
      }
      forceMode={forceMode}
    >
      {/* Thread body */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {loading ? (
          <EmptyState
            size="sm"
            loading
            className="h-full"
            title="Loading thread"
          />
        ) : error ? (
          <div className="flex flex-col items-start gap-3 p-4">
            <p
              role="alert"
              className="flex w-full items-start gap-2 rounded-md bg-danger-tint px-3 py-2 text-ui-sm text-danger-ink"
            >
              <Icon name="warning" size="sm" className="mt-px shrink-0" />
              <span className="min-w-0">{error}</span>
            </p>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void fetchThread()}
            >
              Try again
            </Button>
          </div>
        ) : (
          <div className="flex flex-col pb-4">
            {/* Root message: the thread's trunk, on the panel ply with a seam below */}
            {root && (
              <div className="border-b border-line py-3">
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

            {/* Replies label */}
            {replies.length > 0 ? (
              <p className="px-4 pt-3 pb-1 text-ui-xs text-ink-3">
                <Num>{replies.length}</Num>{" "}
                {replies.length === 1 ? "reply" : "replies"}
              </p>
            ) : root ? (
              <p className="px-4 py-6 text-center text-ui-sm text-ink-3">
                No replies yet. Start the thread below.
              </p>
            ) : null}

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
    <div className="shrink-0 border-t border-line px-3 pt-3 pb-[max(12px,var(--safe-area-bottom,0px))]">
      <div className="flex min-h-11 items-center gap-2 rounded-lg border border-line bg-ply-2 py-1.5 pr-1.5 pl-3 transition-colors duration-(--dur-1) focus-within:border-line-strong">
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
          className="min-w-0 flex-1 bg-transparent text-ui-base text-ink-1 outline-none placeholder:text-ink-3 max-md:text-ui-md"
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
