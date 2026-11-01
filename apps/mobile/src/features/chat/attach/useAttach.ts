import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError } from "@/lib/api";

import { UploadAborted } from "../api";
import { uploadFile } from "../mutations";
import type { Attachment } from "../schema";
import { formatBytes, MAX_FILE_BYTES, MAX_FILES } from "./limits";
import { MediaLibrary } from "./sources";
import type { DraftItem, Notice, PickedFile, UploadState } from "./types";

/** Uploads in flight at once; the server allows 10 a minute in total. */
const PARALLEL = 3;
const NOTICE_MS = 4000;
/** Progress repaints in 5% steps, not on every chunk. */
const PROGRESS_STEP = 0.05;

/** An uploaded file and the local copy it came from. */
export interface SentFile {
  readonly attachment: Attachment;
  /** The picked file's uri: what the optimistic row draws. */
  readonly localUri: string;
}

export interface AttachController {
  readonly items: readonly DraftItem[];
  readonly notice: Notice | null;
  /** Uploading for a send: the field and the attach key wait. */
  readonly sending: boolean;
  readonly add: (files: readonly PickedFile[]) => void;
  /** A recent-media tile: select it, or drop it if it was selected. */
  readonly toggle: (file: PickedFile) => void;
  readonly remove: (key: string) => void;
  /** Uploads a failed file again, ahead of the next send. */
  readonly retry: (key: string) => void;
  readonly warn: (text: string, led?: Notice["led"]) => void;
  /**
   * Uploads whatever is not up yet. Answers with every file in chip order,
   * or null when one failed (its chip says why) or the view left.
   */
  readonly upload: () => Promise<SentFile[] | null>;
  readonly clear: () => void;
}

function failureReason(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 413) return `Over ${formatBytes(MAX_FILE_BYTES)}`;
    if (error.status === 403) return "Not allowed here";
    if (error.status === 429) return "Too many uploads, wait a minute";
    if (error.status === 401) return "Signed out";
    return "Upload failed";
  }
  return "No connection";
}

/** A gallery asset on iOS is a ph:// id; uploads need its file. */
async function uploadUri(item: PickedFile): Promise<string> {
  if (!item.uri.startsWith("ph://") || !MediaLibrary) return item.uri;
  return new MediaLibrary.Asset(item.uri).getUri();
}

async function inPool<T, R>(
  list: readonly T[],
  size: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const index = next++;
      results[index] = await run(list[index]!);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(size, list.length) }, worker),
  );
  return results;
}

/**
 * The composer's attachments for one channel (the tray that picks them
 * opens in the composer's slot, ../slot).
 * Files upload when the message is sent (Discord's order), so toggling tiles
 * in the tray never spends the upload rate limit; a failed one keeps its
 * chip with the reason, and retry or send tries it again.
 */
export function useAttach(channelId: string): AttachController {
  const [items, setItems] = useState<readonly DraftItem[]>([]);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [sending, setSending] = useState(false);

  const itemsRef = useRef(items);
  const inflight = useRef(new Map<string, Promise<Attachment | null>>());
  const aborts = useRef(new Map<string, AbortController>());
  const mounted = useRef(true);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    mounted.current = true;
    const running = aborts.current;
    return () => {
      mounted.current = false;
      for (const controller of running.values()) controller.abort();
    };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  const warn = useCallback((text: string, led: Notice["led"] = "idle") => {
    setNotice((last) => ({ id: (last?.id ?? 0) + 1, text, led }));
  }, []);

  const patch = useCallback((key: string, upload: UploadState) => {
    if (!mounted.current) return;
    setItems((list) =>
      list.map((item) => (item.key === key ? { ...item, upload } : item)),
    );
  }, []);

  const uploadOne = useCallback(
    (item: DraftItem): Promise<Attachment | null> => {
      const running = inflight.current.get(item.key);
      if (running) return running;
      const controller = new AbortController();
      aborts.current.set(item.key, controller);
      const job = (async () => {
        patch(item.key, { phase: "uploading", progress: 0 });
        let shown = 0;
        try {
          const uri = await uploadUri(item);
          const attachment = await uploadFile(
            channelId,
            { uri, name: item.name, type: item.type },
            {
              signal: controller.signal,
              onProgress: (fraction) => {
                if (fraction - shown < PROGRESS_STEP && fraction < 1) return;
                shown = fraction;
                patch(item.key, { phase: "uploading", progress: fraction });
              },
            },
          );
          patch(item.key, { phase: "done", attachment });
          return attachment;
        } catch (error) {
          if (!(error instanceof UploadAborted))
            patch(item.key, { phase: "failed", reason: failureReason(error) });
          return null;
        } finally {
          inflight.current.delete(item.key);
          aborts.current.delete(item.key);
        }
      })();
      inflight.current.set(item.key, job);
      return job;
    },
    [channelId, patch],
  );

  const add = useCallback(
    (files: readonly PickedFile[]) => {
      const current = itemsRef.current;
      let room = MAX_FILES - current.length;
      let tooBig: PickedFile | null = null;
      let overflow = 0;
      const accepted: DraftItem[] = [];
      for (const file of files) {
        if (current.some((item) => item.key === file.key)) continue;
        if (file.size !== null && file.size > MAX_FILE_BYTES) {
          tooBig = file;
          continue;
        }
        if (room <= 0) {
          overflow += 1;
          continue;
        }
        accepted.push({ ...file, upload: { phase: "waiting" } });
        room -= 1;
      }
      if (accepted.length > 0)
        setItems((list) =>
          [
            ...list,
            ...accepted.filter((a) => !list.some((b) => b.key === a.key)),
          ].slice(0, MAX_FILES),
        );
      if (tooBig) warn(`${tooBig.name} is over ${formatBytes(MAX_FILE_BYTES)}`);
      else if (overflow > 0) warn(`Up to ${MAX_FILES} files per message`);
    },
    [warn],
  );

  const remove = useCallback((key: string) => {
    aborts.current.get(key)?.abort();
    setItems((list) => list.filter((item) => item.key !== key));
  }, []);

  const toggle = useCallback(
    (file: PickedFile) => {
      if (itemsRef.current.some((item) => item.key === file.key))
        remove(file.key);
      else add([file]);
    },
    [add, remove],
  );

  const retry = useCallback(
    (key: string) => {
      const item = itemsRef.current.find((entry) => entry.key === key);
      if (item && item.upload.phase === "failed") void uploadOne(item);
    },
    [uploadOne],
  );

  const upload = useCallback(async (): Promise<SentFile[] | null> => {
    const list = itemsRef.current;
    setSending(true);
    const results = await inPool(list, PARALLEL, (item) =>
      item.upload.phase === "done"
        ? Promise.resolve(item.upload.attachment)
        : uploadOne(item),
    );
    if (!mounted.current) return null;
    setSending(false);
    // Chips removed while uploading are dropped, not counted as failures.
    const kept = new Set(itemsRef.current.map((item) => item.key));
    const sent: SentFile[] = [];
    let failed = 0;
    list.forEach((item, index) => {
      if (!kept.has(item.key)) return;
      const attachment = results[index];
      if (attachment) sent.push({ attachment, localUri: item.uri });
      else failed += 1;
    });
    if (failed > 0) {
      warn(
        failed === 1
          ? "A file did not upload. Tap it to retry."
          : `${failed} files did not upload. Tap one to retry.`,
        "danger",
      );
      return null;
    }
    return sent;
  }, [uploadOne, warn]);

  const clear = useCallback(() => {
    setItems([]);
    setNotice(null);
  }, []);

  return {
    items,
    notice,
    sending,
    add,
    toggle,
    remove,
    retry,
    warn,
    upload,
    clear,
  };
}
