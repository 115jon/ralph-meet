import { createFileRoute } from "@tanstack/react-router";

import { apiError, apiSuccess, getBucket, getDB, getEnv, requireAuth } from "@/lib/api-helpers";
import {
  MAX_AI_EMOJI_PROMPT_LENGTH,
  buildGeneratedEmojiShortcode,
  buildGeneratedEmojiStorageKey,
  sanitizeGeneratedEmojiShortcode,
  type GeneratedEmoji,
} from "@/lib/emoji";
import { checkRateLimitDO } from "@/lib/rate-limit";
import {
  createGeneratedEmoji,
  listGeneratedEmojisByIds,
  listUserGeneratedEmojis,
  markGeneratedEmojiFailed,
  markGeneratedEmojiReady,
} from "@/services/emoji.service";

import { normalizeKlipyGeneratedStatusResponse } from "./-emojis.shared";

class KlipyRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

type GenerateEmojiBody = {
  prompt?: unknown;
  shortcode?: unknown;
};

type KlipyGenerateResponse = {
  data?: {
    id?: string;
  };
};

function getKlipyApiKey(): string | null {
  const env = getEnv() as unknown as { KLIPY_API_KEY?: string };
  return typeof env.KLIPY_API_KEY === "string" && env.KLIPY_API_KEY.trim() ? env.KLIPY_API_KEY.trim() : null;
}

async function fetchKlipy(path: string, init?: RequestInit) {
  const apiKey = getKlipyApiKey();
  if (!apiKey) {
    throw new Error("KLIPY API key is not configured");
  }

  const url = `https://api.klipy.com${path.replace("{app_key}", apiKey)}`;
  const response = await fetch(url, {
    ...init,
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; RalphMeet/1.0; +https://ralph.dev)",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    throw new KlipyRequestError(`KLIPY request failed with ${response.status}`, response.status);
  }

  return response.json();
}

function normalizePrompt(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, MAX_AI_EMOJI_PROMPT_LENGTH);
}

function normalizeShortcode(value: unknown, prompt: string): string {
  if (typeof value === "string" && value.trim()) {
    return sanitizeGeneratedEmojiShortcode(value, 32);
  }
  return buildGeneratedEmojiShortcode(prompt);
}

function decodeBase64Bytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

async function syncGeneratedEmoji(item: GeneratedEmoji): Promise<GeneratedEmoji> {
  if (item.status !== "pending") return item;

  try {
    const status = normalizeKlipyGeneratedStatusResponse(
      await fetchKlipy(`/api/v1/{app_key}/emojis/generated/${encodeURIComponent(item.id)}`),
    );

    if (status.status === "failed") {
      await markGeneratedEmojiFailed(getDB(), {
        id: item.id,
        errorMessage: "Generation failed",
      });
      return {
        ...item,
        status: "failed",
        error_message: "Generation failed",
        updated_at: new Date().toISOString(),
      };
    }

    if (status.status !== "success" || !status.base64Encoded || !status.mimeType) {
      return item;
    }

    const contentType = status.mimeType.toLowerCase();
    const buffer = decodeBase64Bytes(status.base64Encoded);
    const fileKey = buildGeneratedEmojiStorageKey(item.user_id, item.id, contentType);

    await getBucket().put(fileKey, buffer, {
      httpMetadata: { contentType },
    });

    await markGeneratedEmojiReady(getDB(), {
      id: item.id,
      fileKey,
      contentType,
      sizeBytes: buffer.byteLength,
    });

    return {
      ...item,
      status: "ready",
      image_url: `/api/emojis/assets/${item.id}`,
      content_type: contentType,
      size_bytes: buffer.byteLength,
      error_message: null,
      updated_at: new Date().toISOString(),
    };
  } catch {
    return item;
  }
}

async function syncGeneratedEmojiList(items: GeneratedEmoji[]): Promise<GeneratedEmoji[]> {
  return Promise.all(items.map((item) => syncGeneratedEmoji(item)));
}

const GET = async ({ request }: any) => {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  const url = new URL(request.url);
  const rawIds = url.searchParams.get("ids");

  try {
    const items = rawIds
      ? await listGeneratedEmojisByIds(
        getDB(),
        rawIds
          .split(",")
          .map((entry) => entry.trim())
          .filter(Boolean)
          .slice(0, 64),
      )
      : await listUserGeneratedEmojis(getDB(), authResult.userId, 64);

    return apiSuccess({ items: await syncGeneratedEmojiList(items) }, 200, request);
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "Failed to load emojis", 500, "EMOJI_LOAD_FAILED", request);
  }
};

const POST = async ({ request }: any) => {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  const rateLimitResponse = await checkRateLimitDO(
    authResult.userId,
    "emoji-generate",
    { limit: 5, windowMs: 60_000 },
  );
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const body = await request.json() as GenerateEmojiBody;
    const prompt = normalizePrompt(body.prompt);
    if (!prompt) {
      return apiError("Emoji prompt is required", 400, "EMOJI_PROMPT_REQUIRED", request);
    }

    const shortcode = normalizeShortcode(body.shortcode, prompt);
    const response = await fetchKlipy("/api/v1/{app_key}/emojis/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prompt }),
    }) as KlipyGenerateResponse;

    const id = response.data?.id?.trim();
    if (!id) {
      return apiError("KLIPY did not return an emoji id", 502, "KLIPY_INVALID_EMOJI_RESPONSE", request);
    }

    const item = await createGeneratedEmoji(getDB(), {
      id,
      userId: authResult.userId,
      shortcode,
      prompt,
    });

    return apiSuccess({ item }, 201, request);
  } catch (error) {
    if (error instanceof KlipyRequestError && error.status === 429) {
      return apiError("KLIPY is rate limited. Try again shortly.", 429, "KLIPY_RATE_LIMITED", request);
    }

    return apiError(error instanceof Error ? error.message : "Failed to generate emoji", 502, "EMOJI_GENERATE_FAILED", request);
  }
};

export const Route = createFileRoute("/api/emojis")({
  server: {
    handlers: {
      GET,
      POST,
    },
  },
});
