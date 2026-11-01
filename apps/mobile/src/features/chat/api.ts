import { apiFetch, apiJson, ApiError } from "@/lib/api";

import {
  MemberListSchema,
  MessagePageSchema,
  MessageSchema,
  UploadSchema,
  type Message,
} from "./schema";

export const PAGE_SIZE = 50;

const JSON_HEADERS = { "Content-Type": "application/json" };

function channelPath(channelId: string, rest = ""): string {
  return `/api/channels/${encodeURIComponent(channelId)}${rest}`;
}

/** A write whose answer the app does not read; throws on a non-2xx. */
async function send(
  path: string,
  method: "POST" | "PATCH" | "PUT" | "DELETE",
  body: unknown,
): Promise<void> {
  const response = await apiFetch(path, {
    method,
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new ApiError(response.status, path);
}

/**
 * GET /api/channels/:id/messages: the newest page, or the page before
 * `before` (oldest first, as the server sends it).
 */
export function fetchMessages(channelId: string, before?: Message) {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
  // The server's cursor is "created_at|id", so equal timestamps page cleanly.
  if (before) params.set("before", `${before.created_at}|${before.id}`);
  return apiJson(
    channelPath(channelId, `/messages?${params}`),
    MessagePageSchema,
  );
}

export interface NewMessage {
  readonly content: string;
  readonly nonce: string;
  readonly replyToId?: string;
  readonly attachmentIds?: readonly string[];
}

/** POST /api/channels/:id/messages: answers with the stored message. */
export function postMessage(channelId: string, message: NewMessage) {
  return apiJson(channelPath(channelId, "/messages"), MessageSchema, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({
      content: message.content,
      nonce: message.nonce,
      reply_to_id: message.replyToId,
      attachment_ids: message.attachmentIds,
    }),
  });
}

/** PATCH /api/channels/:id/messages: the author edits the text. */
export function patchMessage(
  channelId: string,
  messageId: string,
  content: string,
): Promise<void> {
  return send(channelPath(channelId, "/messages"), "PATCH", {
    message_id: messageId,
    content,
  });
}

/** DELETE /api/channels/:id/messages */
export function deleteMessage(
  channelId: string,
  messageId: string,
): Promise<void> {
  return send(channelPath(channelId, "/messages"), "DELETE", {
    message_id: messageId,
  });
}

/** PUT or DELETE /api/channels/:id/reactions for the signed-in user. */
export function setReaction(
  channelId: string,
  messageId: string,
  emoji: string,
  on: boolean,
): Promise<void> {
  return send(channelPath(channelId, "/reactions"), on ? "PUT" : "DELETE", {
    message_id: messageId,
    emoji,
  });
}

/** POST /api/channels/:id/typing: shows "typing" to the channel for ~8s. */
export function postTyping(channelId: string): Promise<void> {
  return send(channelPath(channelId, "/typing"), "POST", {});
}

export interface UploadFile {
  readonly uri: string;
  readonly name: string;
  readonly type: string;
}

/**
 * POST /api/channels/:id/messages/upload: stores one file, unattached until
 * a message names its id in `attachment_ids`.
 */
export function uploadAttachment(channelId: string, file: UploadFile) {
  const form = new FormData();
  // React Native's FormData streams a { uri, name, type } part from disk.
  form.append("file", file as unknown as Blob);
  return apiJson(channelPath(channelId, "/messages/upload"), UploadSchema, {
    method: "POST",
    body: form,
  });
}

/** GET /api/servers/:id/members */
export function fetchMembers(serverId: string) {
  return apiJson(
    `/api/servers/${encodeURIComponent(serverId)}/members`,
    MemberListSchema,
  );
}
