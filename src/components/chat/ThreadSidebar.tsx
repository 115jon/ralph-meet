
import { apiGet, apiPost } from "@/lib/api-client";
import type { Message } from "@/lib/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, X } from "./Icons";
import MessageItem from "./MessageItem";

interface Props {
  channelId: string;
  rootMessageId: string;
  currentUserId?: string;
  canPin: boolean;
  onReply: (message: Message) => void;
  onPin: (message: Message) => void;
  onUnpin: (messageId: string, skipConfirm?: boolean) => void;
  onJump: (messageId: string) => void;
  onBan?: (userId: string, username: string) => void;
  onClose: () => void;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true });
  if (d.toDateString() === today.toDateString()) return `Today at ${time}`;
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday at ${time}`;
  return `${d.toLocaleDateString([], { month: "2-digit", day: "2-digit", year: "numeric" })} ${time}`;
}

export default function ThreadSidebar({
  channelId,
  rootMessageId,
  currentUserId,
  canPin,
  onReply,
  onPin,
  onUnpin,
  onJump,
  onBan,
  onClose
}: Props) {
  const [root, setRoot] = useState<Message | null>(null);
  const [replies, setReplies] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const fetchThread = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    if (!silent) setError(null);
    try {
      const data = await apiGet<{ root: Message; replies: Message[] }>(`/api/channels/${channelId}/thread?message_id=${rootMessageId}`);
      setRoot(data.root);
      setReplies(data.replies);
    } catch (err: any) {
      if (!silent) setError(err.message || "Failed to load thread");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [channelId, rootMessageId]);

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
      } catch { /* ignore */ }
    };

    window.addEventListener("chat-gateway-event", handler);
    // Removed the 10s generic polling interval that caused layout flashes.
    // WebSockets handle the real-time flow.
    return () => {
      window.removeEventListener("chat-gateway-event", handler);
    };
  }, [rootMessageId]);

  const handleSendReply = useCallback(async (content: string) => {
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
    setReplies(prev => [...prev, tempMsg]);

    try {
      const newMsg = await apiPost<Message>(`/api/channels/${channelId}/messages`, {
        content,
        reply_to_id: rootMessageId,
      });

      // Deduplicate: If WS already inserted the real message, just delete the temp one
      setReplies(prev => {
        if (prev.some(m => m.id === newMsg.id && m.id !== tempId)) {
          return prev.filter(m => m.id !== tempId);
        }
        // Otherwise replace temp message with the actual REST response message
        return prev.map(m => m.id === tempId ? newMsg : m);
      });
    } catch (err: any) {
      console.error("Failed to send reply:", err);
      // Revert optimistic add on failure
      setReplies(prev => prev.filter(m => m.id !== tempId));
    }
  }, [channelId, rootMessageId, currentUserId]);

  return (
    <div className="flex h-full w-[380px] flex-col border-l border-rm-border bg-rm-bg-primary">
      {/* Header */}
      <div className="flex h-12 items-center justify-between border-b border-rm-border px-4">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-bold text-rm-text">Thread</h2>
          <span className="text-xs text-rm-text-muted">
            {replies.length} {replies.length === 1 ? "reply" : "replies"}
          </span>
        </div>
        <button
          onClick={onClose}
          className="rounded-lg p-1.5 text-rm-text-muted transition-colors hover:bg-rm-bg-hover hover:text-rm-text outline-none"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Thread body */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-rm-text-muted" />
          </div>
        ) : error ? (
          <div className="flex h-full items-center justify-center text-sm text-red-400">{error}</div>
        ) : (
          <div className="flex flex-col gap-1 pb-4">
            {/* Root message */}
            {root && (
              <div className="rounded-xl border border-rm-border bg-rm-bg-surface py-2 mb-2">
                <MessageItem
                  id={`thread-root-${root.id}`}
                  message={root}
                  showHeader={true}
                  hideReplyConnector={true}
                  currentUserId={currentUserId}
                  canPin={canPin}
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
              <div className="my-2 flex items-center gap-2 px-2">
                <div className="h-px flex-1 bg-rm-border" />
                <span className="text-[10px] font-bold uppercase tracking-wider text-rm-text-muted">
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
                  showHeader = (curTime - prevTime) > 5 * 60 * 1000;
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
    </div>
  );
}

function ThreadReplyInput({ onSend }: { onSend: (content: string) => Promise<void> }) {
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
    <div className="border-t border-rm-border px-3 py-2.5">
      <div className="flex items-center gap-2 rounded-xl border border-rm-border bg-rm-bg-surface px-3 py-2 focus-within:border-primary/30 focus-within:ring-2 focus-within:ring-primary/20 transition-all">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}
          placeholder="Reply to thread…"
          className="flex-1 bg-transparent text-sm text-rm-text outline-none placeholder:text-rm-text-muted/30"
        />
        <button
          onClick={handleSubmit}
          disabled={!value.trim() || sending}
          className="shrink-0 rounded-lg bg-primary px-3 py-1 text-xs font-bold text-primary-foreground transition-all hover:brightness-110 disabled:opacity-30"
        >
          {sending ? "…" : "Send"}
        </button>
      </div>
    </div>
  );
}
