"use client";

import type { Message } from "@/lib/types";
import NextImage from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, X } from "./Icons";
import { MarkdownRenderer } from "./MarkdownRenderer";

interface Props {
  channelId: string;
  rootMessageId: string;
  currentUserId?: string;
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

export default function ThreadSidebar({ channelId, rootMessageId, currentUserId, onClose }: Props) {
  const [root, setRoot] = useState<Message | null>(null);
  const [replies, setReplies] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const fetchThread = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/channels/${channelId}/thread?message_id=${rootMessageId}`);
      if (!res.ok) {
        setError("Failed to load thread");
        return;
      }
      const data = await res.json() as { root: Message; replies: Message[] };
      setRoot(data.root);
      setReplies(data.replies);
    } catch {
      setError("Failed to load thread");
    } finally {
      setLoading(false);
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

  // Listen for new messages in this channel that are replies to this thread
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        if (data.event === "MESSAGE_CREATE" && data.data?.reply_to_id === rootMessageId) {
          setReplies(prev => [...prev, data.data]);
        }
      } catch { /* ignore */ }
    };
    // We can't easily listen to WebSocket here, so we'll poll every few seconds
    const interval = setInterval(fetchThread, 10000);
    return () => clearInterval(interval);
  }, [rootMessageId, fetchThread]);

  const handleSendReply = useCallback(async (content: string) => {
    const res = await fetch(`/api/channels/${channelId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content,
        reply_to_id: rootMessageId,
      }),
    });
    if (res.ok) {
      const newMsg = await res.json() as Message;
      setReplies(prev => [...prev, newMsg]);
    }
  }, [channelId, rootMessageId]);

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
          <>
            {/* Root message */}
            {root && (
              <div className="mb-4 rounded-xl border border-rm-border bg-rm-bg-surface p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="relative h-8 w-8 shrink-0 overflow-hidden rounded-full bg-primary/10">
                    {root.author?.avatar_url ? (
                      <NextImage src={root.author.avatar_url} alt="" fill className="object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-xs font-bold text-primary">
                        {(root.author?.username ?? "?")[0].toUpperCase()}
                      </div>
                    )}
                  </div>
                  <div>
                    <span className="text-sm font-bold text-rm-text">{root.author?.username ?? "Unknown"}</span>
                    <span className="ml-2 text-[11px] text-rm-text-muted">{formatDate(root.created_at)}</span>
                  </div>
                </div>
                <div className="text-[15px] font-medium leading-relaxed text-rm-text">
                  <MarkdownRenderer content={root.content} />
                </div>
              </div>
            )}

            {/* Divider */}
            {replies.length > 0 && (
              <div className="my-3 flex items-center gap-2">
                <div className="h-px flex-1 bg-rm-border" />
                <span className="text-[10px] font-bold uppercase tracking-wider text-rm-text-muted">
                  {replies.length} {replies.length === 1 ? "Reply" : "Replies"}
                </span>
                <div className="h-px flex-1 bg-rm-border" />
              </div>
            )}

            {/* Replies */}
            {replies.map((reply) => (
              <div key={reply.id} className="mb-3 flex gap-3">
                <div className="relative mt-0.5 h-7 w-7 shrink-0 overflow-hidden rounded-full bg-primary/10">
                  {reply.author?.avatar_url ? (
                    <NextImage src={reply.author.avatar_url} alt="" fill className="object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-[10px] font-bold text-primary">
                      {(reply.author?.username ?? "?")[0].toUpperCase()}
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-bold text-rm-text">{reply.author?.username ?? "Unknown"}</span>
                    <span className="text-[10px] text-rm-text-muted">{formatDate(reply.created_at)}</span>
                  </div>
                  <div className="text-[14px] font-medium leading-relaxed text-rm-text">
                    <MarkdownRenderer content={reply.content} />
                  </div>
                </div>
              </div>
            ))}

            <div ref={bottomRef} />
          </>
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
