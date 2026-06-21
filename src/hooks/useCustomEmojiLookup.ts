import { useEffect, useMemo, useReducer } from "react";

import { apiGet } from "@/lib/api-client";
import type { GeneratedEmoji, GeneratedEmojiListResponse } from "@/lib/emoji";

const emojiCache = new Map<string, GeneratedEmoji>();
const inFlightRequests = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();

function notifyListeners() {
  for (const listener of listeners) {
    listener();
  }
}

export function primeCustomEmojiCache(items: GeneratedEmoji[]): void {
  let changed = false;

  for (const item of items) {
    const current = emojiCache.get(item.id);
    if (
      !current ||
      current.updated_at !== item.updated_at ||
      current.status !== item.status ||
      current.image_url !== item.image_url
    ) {
      emojiCache.set(item.id, item);
      changed = true;
    }
  }

  if (changed) {
    notifyListeners();
  }
}

async function ensureCustomEmojiIds(ids: string[]): Promise<void> {
  const missing = Array.from(new Set(ids.filter((id) => id && !emojiCache.has(id))));
  if (missing.length === 0) return;

  const requestKey = missing.slice().sort().join(",");
  const existingRequest = inFlightRequests.get(requestKey);
  if (existingRequest) {
    await existingRequest;
    return;
  }

  const request = apiGet<GeneratedEmojiListResponse>(`/api/emojis?ids=${encodeURIComponent(missing.join(","))}`)
    .then((response) => {
      primeCustomEmojiCache(response.items);
    })
    .finally(() => {
      inFlightRequests.delete(requestKey);
    });

  inFlightRequests.set(requestKey, request);
  await request;
}

export function useCustomEmojiLookup(ids: string[]): Record<string, GeneratedEmoji> {
  const normalizedIds = useMemo(
    () => Array.from(new Set(ids.filter(Boolean))),
    [ids.join(",")],
  );
  const [version, forceRender] = useReducer((value: number) => value + 1, 0);

  useEffect(() => {
    const handleCacheChange = () => {
      forceRender();
    };

    listeners.add(handleCacheChange);
    return () => {
      listeners.delete(handleCacheChange);
    };
  }, []);

  useEffect(() => {
    if (normalizedIds.length === 0) return;

    let cancelled = false;

    void ensureCustomEmojiIds(normalizedIds)
      .then(() => {
        if (!cancelled) {
          forceRender();
        }
      })
      .catch(() => {
        // Inline rendering can gracefully fall back to raw token text.
      });

    return () => {
      cancelled = true;
    };
  }, [normalizedIds.join(",")]);

  return useMemo(() => {
    const map: Record<string, GeneratedEmoji> = {};

    for (const id of normalizedIds) {
      const item = emojiCache.get(id);
      if (item) {
        map[id] = item;
      }
    }

    return map;
  }, [normalizedIds.join(","), normalizedIds.length, version]);
}
