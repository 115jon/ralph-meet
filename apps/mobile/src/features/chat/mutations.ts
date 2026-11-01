import { useSession } from "@/features/auth/session";
import { showToast } from "@/ui";

import {
  applyReaction,
  editMessage as applyEdit,
  receiveMessage,
  removeMessage,
  setSendState,
  stopTyping,
} from "./actions";
import * as api from "./api";
import type { Attachment, Message } from "./schema";
import { pendingId, type ChatMessage } from "./store";

// Writes to the server. Each one changes the store first where it is safe to
// guess the outcome, then reconciles with the answer or the gateway echo.

function me() {
  return useSession.getState().user;
}

function failed(text: string): void {
  showToast({ label: "Not saved", text, led: "danger" });
}

// ── Send ───────────────────────────────────────────────────────────────────

export interface Draft {
  readonly content: string;
  readonly replyTo?: Message;
  readonly attachments?: readonly Attachment[];
}

/** What a failed send needs to go again with the same nonce. */
const unsent = new Map<string, { channelId: string; body: api.NewMessage }>();

function newNonce(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

async function post(nonce: string): Promise<void> {
  const entry = unsent.get(nonce);
  if (!entry) return;
  const id = pendingId(nonce);
  setSendState(id, "sending");
  try {
    const message = await api.postMessage(entry.channelId, entry.body);
    unsent.delete(nonce);
    // The answer and MESSAGE_CREATE carry the nonce; whichever lands first
    // replaces the optimistic row.
    receiveMessage(message);
  } catch {
    setSendState(id, "failed");
  }
}

/**
 * Sends a message: an optimistic row appears at once with `send:
 * "sending"`, and the server's copy replaces it by nonce (the web's
 * chat-actions sendMessage flow). A failure leaves the row as "failed",
 * with retry and discard.
 */
export function sendMessage(channelId: string, draft: Draft): void {
  const user = me();
  if (!user) return;
  const nonce = newNonce();
  const body: api.NewMessage = {
    content: draft.content,
    nonce,
    replyToId: draft.replyTo?.id,
    attachmentIds: draft.attachments?.map((attachment) => attachment.id),
  };
  const replyTo = draft.replyTo;
  const optimistic: ChatMessage = {
    id: pendingId(nonce),
    channel_id: channelId,
    author_id: user.id,
    author: {
      id: user.id,
      username: user.username,
      display_name: user.display_name,
      avatar_url: user.avatar_url,
    },
    content: draft.content,
    created_at: new Date().toISOString(),
    reply_to_id: replyTo?.id ?? null,
    reply_to: replyTo
      ? {
          id: replyTo.id,
          content: replyTo.content,
          author_id: replyTo.author_id,
          author: replyTo.author,
        }
      : null,
    attachments: draft.attachments ?? [],
    reactions: [],
    nonce,
    send: "sending",
  };
  unsent.set(nonce, { channelId, body });
  receiveMessage(optimistic);
  stopTyping(channelId, user.id);
  lastTypingSent.delete(channelId);
  void post(nonce);
}

export function retrySend(message: ChatMessage): void {
  if (message.nonce) void post(message.nonce);
}

/** Drops a failed row; returns its text so the composer can take it back. */
export function discardSend(message: ChatMessage): string {
  if (message.nonce) unsent.delete(message.nonce);
  removeMessage(message.id);
  return message.content ?? "";
}

// ── Edit and delete ────────────────────────────────────────────────────────

export async function editMessage(
  message: Message,
  content: string,
): Promise<void> {
  const before = message.content;
  applyEdit(message.id, { content });
  try {
    await api.patchMessage(message.channel_id, message.id, content);
  } catch {
    applyEdit(message.id, { content: before });
    failed("The edit did not go through.");
  }
}

export async function deleteMessage(message: ChatMessage): Promise<void> {
  if (message.send) {
    discardSend(message);
    return;
  }
  try {
    await api.deleteMessage(message.channel_id, message.id);
    // MESSAGE_DELETE also removes it; this covers a socket that is down.
    removeMessage(message.id);
  } catch {
    failed("The message was not deleted.");
  }
}

// ── Reactions ──────────────────────────────────────────────────────────────

export async function toggleReaction(
  message: Message,
  emoji: string,
): Promise<void> {
  const user = me();
  if (!user) return;
  const on = !message.reactions?.some(
    (reaction) => reaction.emoji === emoji && reaction.me,
  );
  applyReaction(message.id, emoji, user.id, true, on);
  try {
    await api.setReaction(message.channel_id, message.id, emoji, on);
  } catch {
    applyReaction(message.id, emoji, user.id, true, !on);
    failed("The reaction did not go through.");
  }
}

// ── Typing ─────────────────────────────────────────────────────────────────

/** The web composer's throttle: at most one typing ping per 3s. */
const TYPING_EVERY_MS = 3000;
const lastTypingSent = new Map<string, number>();

export function notifyTyping(channelId: string): void {
  const now = Date.now();
  if (now - (lastTypingSent.get(channelId) ?? 0) < TYPING_EVERY_MS) return;
  lastTypingSent.set(channelId, now);
  api.postTyping(channelId).catch(() => undefined);
}

// ── Attachments ────────────────────────────────────────────────────────────

/** Uploads one picked file; the attachment rides on the next send. */
export async function uploadFile(
  channelId: string,
  file: api.UploadFile,
): Promise<Attachment | null> {
  try {
    const uploaded = await api.uploadAttachment(channelId, file);
    return {
      id: uploaded.id,
      filename: uploaded.file_name,
      content_type: uploaded.content_type,
      url: uploaded.file_url,
    };
  } catch {
    failed(`${file.name} did not upload.`);
    return null;
  }
}
