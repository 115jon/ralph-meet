import type { PermissionResponse } from "expo-media-library";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Linking, Platform } from "react-native";

import { MediaLibrary, mimeFor } from "./sources";
import type { PickedFile } from "./types";

const PAGE = 60;
const MEDIA: ("photo" | "video")[] = ["photo", "video"];

/**
 * How much of the gallery the app may read. `ask` has not been asked yet,
 * `denied` may ask again, `blocked` can only change in system settings.
 */
export type MediaAccess =
  | "unavailable"
  | "checking"
  | "ask"
  | "denied"
  | "blocked"
  | "limited"
  | "all";

function accessFrom(permission: PermissionResponse): MediaAccess {
  if (permission.granted) {
    // Android 14+ "Select photos" and iOS limited both read as granted.
    return permission.accessPrivileges === "limited" ? "limited" : "all";
  }
  if (permission.status === "undetermined") return "ask";
  return permission.canAskAgain ? "denied" : "blocked";
}

const canRead = (access: MediaAccess) =>
  access === "all" || access === "limited";

/**
 * The newest photos and videos for the tray grid, a page at a time, and the
 * permission state behind them. Asks for access the first time the tray
 * opens and checks again whenever the app comes back to the foreground
 * (back from settings or the "select more" picker).
 */
export function useRecentMedia(active: boolean) {
  const [access, setAccess] = useState<MediaAccess>(
    MediaLibrary ? "checking" : "unavailable",
  );
  const [assets, setAssets] = useState<readonly PickedFile[]>([]);
  const [complete, setComplete] = useState(false);
  const accessRef = useRef(access);
  const loading = useRef(false);
  // Bumped on every reload, so a page that lands late is dropped.
  const generation = useRef(0);
  const asked = useRef(false);

  const load = useCallback(async (from: number) => {
    const library = MediaLibrary;
    if (!library || loading.current) return;
    loading.current = true;
    const run = generation.current;
    try {
      const page = await new library.Query()
        .within(library.AssetField.MEDIA_TYPE, [
          library.MediaType.IMAGE,
          library.MediaType.VIDEO,
        ])
        // Modified, not taken: saved and downloaded images have no
        // DATE_TAKEN and would sink to the bottom.
        .orderBy({
          key: library.AssetField.MODIFICATION_TIME,
          ascending: false,
        })
        .limit(PAGE)
        .offset(from)
        .exeForMetadata();
      if (run !== generation.current) return;
      const next = page.map((meta): PickedFile => {
        const kind =
          meta.mediaType === library.MediaType.VIDEO ? "video" : "image";
        const name =
          meta.filename ?? `${kind}-${meta.id.split("/").pop() ?? Date.now()}`;
        return {
          key: meta.id,
          // On Android the id is the asset's content:// uri, which both
          // expo-image and the upload read directly.
          uri: meta.id,
          name,
          type: mimeFor(name, kind),
          size: null,
          kind,
          // MediaStore reports milliseconds on Android, iOS seconds.
          duration:
            meta.duration == null
              ? null
              : Platform.OS === "android"
                ? meta.duration / 1000
                : meta.duration,
        };
      });
      setAssets((list) => (from === 0 ? next : [...list, ...next]));
      setComplete(next.length < PAGE);
    } catch {
      if (run === generation.current) setComplete(true);
    } finally {
      if (run === generation.current) loading.current = false;
    }
  }, []);

  const reload = useCallback(() => {
    generation.current += 1;
    loading.current = false;
    void load(0);
  }, [load]);

  const settle = useCallback(
    (next: MediaAccess) => {
      const before = accessRef.current;
      accessRef.current = next;
      setAccess(next);
      if (canRead(next)) {
        // A change in what is shared (more photos picked) needs a fresh page.
        if (before !== next || next === "limited") reload();
      } else {
        setAssets([]);
      }
    },
    [reload],
  );

  const check = useCallback(async () => {
    const library = MediaLibrary;
    if (!library) return;
    try {
      settle(accessFrom(await library.getPermissionsAsync(false, MEDIA)));
    } catch {
      settle("blocked");
    }
  }, [settle]);

  const request = useCallback(async () => {
    const library = MediaLibrary;
    if (!library) return;
    if (accessRef.current === "blocked") {
      await Linking.openSettings();
      return;
    }
    try {
      settle(accessFrom(await library.requestPermissionsAsync(false, MEDIA)));
    } catch {
      settle("blocked");
    }
  }, [settle]);

  /** Android 14+ and iOS: let the user share more photos than the first pick. */
  const shareMore = useCallback(async () => {
    const library = MediaLibrary;
    if (!library) return;
    try {
      await library.presentPermissionsPicker(MEDIA);
    } finally {
      await check();
    }
  }, [check]);

  // First open: read the permission, and ask once if it was never asked.
  useEffect(() => {
    if (!active || asked.current || !MediaLibrary) return;
    asked.current = true;
    void (async () => {
      await check();
      if (accessRef.current === "ask") await request();
    })();
  }, [active, check, request]);

  // Back from settings or the system picker: the grant may have changed.
  useEffect(() => {
    if (!MediaLibrary) return;
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active" && asked.current) void check();
    });
    return () => sub.remove();
  }, [check]);

  // New photos (a screenshot, a download) show up without reopening.
  useEffect(() => {
    const library = MediaLibrary;
    if (!library || !canRead(access)) return;
    const sub = library.addListener(() => reload());
    return () => sub.remove();
  }, [access, reload]);

  const loadMore = useCallback(() => {
    if (!complete && canRead(accessRef.current)) void load(assets.length);
  }, [assets.length, complete, load]);

  return { access, assets, loadMore, request, shareMore };
}
