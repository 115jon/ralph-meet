import { Schema } from "effect";

import { useSession } from "@/features/auth/session";
import { apiFetch, apiJson, ApiError } from "@/lib/api";
import { config } from "@/lib/config";

import {
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

/** Which page: before or after a loaded message, or around a message id. */
export type PageCursor =
  | { readonly before: Message }
  | { readonly after: Message }
  | { readonly around: string };

/** The server's cursor is "created_at|id", so equal timestamps page cleanly. */
function cursorOf(message: Message): string {
  return `${message.created_at}|${message.id}`;
}

/**
 * GET /api/channels/:id/messages: the newest page, or the page before or
 * after a loaded message, or the one around a message id (a jump). Oldest
 * first, as the server sends it.
 */
export function fetchMessages(channelId: string, cursor?: PageCursor) {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
  if (cursor && "before" in cursor)
    params.set("before", cursorOf(cursor.before));
  else if (cursor && "after" in cursor)
    params.set("after", cursorOf(cursor.after));
  else if (cursor) params.set("around", cursor.around);
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

/** An upload stopped by its signal (the chip was removed). */
export class UploadAborted extends Error {
  constructor() {
    super("Upload cancelled");
    this.name = "UploadAborted";
  }
}

export interface UploadOptions {
  /** 0 to 1 as the body goes out. */
  readonly onProgress?: (fraction: number) => void;
  readonly signal?: AbortSignal;
}

/**
 * POST /api/channels/:id/messages/upload: stores one file, unattached until
 * a message names its id in `attachment_ids`. XMLHttpRequest rather than
 * fetch, which reports no upload progress. Rejects with ApiError on a
 * non-2xx (413 too large, 403 no ATTACH_FILES, 429 rate limited) and with
 * UploadAborted when `signal` fires.
 */
export function uploadAttachment(
  channelId: string,
  file: UploadFile,
  { onProgress, signal }: UploadOptions = {},
) {
  const path = channelPath(channelId, "/messages/upload");
  return new Promise<typeof UploadSchema.Type>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    signal?.addEventListener("abort", abort);
    const done = () => signal?.removeEventListener("abort", abort);

    xhr.open("POST", `${config.apiBaseUrl}${path}`);
    const { token } = useSession.getState();
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0)
        onProgress?.(event.loaded / event.total);
    };
    xhr.onload = () => {
      done();
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new ApiError(xhr.status, path));
        return;
      }
      try {
        resolve(
          Schema.decodeUnknownSync(UploadSchema)(JSON.parse(xhr.responseText)),
        );
      } catch (error) {
        reject(error);
      }
    };
    xhr.onerror = () => {
      done();
      reject(new TypeError("Network request failed"));
    };
    xhr.onabort = () => {
      done();
      reject(new UploadAborted());
    };

    const form = new FormData();
    // React Native's FormData streams a { uri, name, type } part from disk.
    form.append("file", file as unknown as Blob);
    xhr.send(form);
  });
}
