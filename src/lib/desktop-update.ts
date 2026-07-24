import { Channel, invoke } from "@tauri-apps/api/core";

export type DesktopUpdateMetadata = {
  version: string;
  currentVersion: string;
  notes: string | null;
};

export type DesktopDownloadEvent =
  | { event: "started"; data: { contentLength: number | null } }
  | { event: "progress"; data: { chunkLength: number } }
  | { event: "finished" };

const UPDATE_CHECK_TIMEOUT_MS = 10_000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Desktop update check timed out"));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function fetchDesktopUpdate(): Promise<DesktopUpdateMetadata | null> {
  return withTimeout(
    invoke<DesktopUpdateMetadata | null>("fetch_update"),
    UPDATE_CHECK_TIMEOUT_MS,
  );
}

export function installDesktopUpdate(
  onEvent: (event: DesktopDownloadEvent) => void,
): Promise<void> {
  const onEventChannel = new Channel<DesktopDownloadEvent>(onEvent);
  return invoke<void>("install_update", { onEvent: onEventChannel });
}
