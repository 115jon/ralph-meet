/**
 * useNativeScreenCapture — Desktop-only hook that captures screen frames
 * natively via a local WebSocket server and creates a MediaStream.
 *
 * Flow:
 *   1. Frontend calls start_capture_server → Rust binds a WebSocket on 127.0.0.1:<port>
 *   2. Frontend connects to ws://127.0.0.1:<port>
 *   3. Rust captures frames via xcap → encodes as raw JPEG bytes → sends as binary WS message
 *   4. Frontend: createImageBitmap(blob) → OffscreenCanvas → captureStream() → MediaStream
 *
 * This bypasses getDisplayMedia() entirely — no system picker dialog.
 *
 * Key improvement over old approach:
 *   - Old: xcap → JPEG → base64 → JSON → Tauri IPC → string parse → new Image() → canvas  (~10fps)
 *   - New: xcap → JPEG → binary WS → ArrayBuffer → createImageBitmap() → canvas  (~30fps)
 */

import { isTauri } from "@/lib/platform";
import { useCallback, useRef } from "react";

interface CaptureOptions {
  sourceId: string;
  maxWidth: number;
  fps: number;
  withAudio: boolean;
}

export function useNativeScreenCapture() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const runningRef = useRef(false);

  /**
   * Start native screen capture and return a MediaStream.
   * Call stopCapture() when done.
   */
  const startCapture = useCallback(async (options: CaptureOptions): Promise<MediaStream | null> => {
    if (!isTauri()) return null;

    const { invoke } = await import("@tauri-apps/api/core");

    // Start the Rust WebSocket capture server — returns the port
    const port = await invoke<number>("start_capture_server", {
      sourceId: options.sourceId,
      maxWidth: options.maxWidth,
      fps: options.fps,
    });

    if (!port) {
      console.error("[NativeCapture] Failed to start capture server");
      return null;
    }

    console.log(`[NativeCapture] Capture server on port ${port}, connecting...`);

    // Create canvas for rendering frames
    const canvas = document.createElement("canvas");
    canvas.width = options.maxWidth;
    canvas.height = Math.round(options.maxWidth * 9 / 16); // 16:9 default
    canvasRef.current = canvas;
    const ctx = canvas.getContext("2d")!;
    let firstFrame = true;
    runningRef.current = true;

    // Connect to the local WebSocket server
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    // Set up frame receiver
    const framePromise = new Promise<void>((resolve) => {
      ws.onopen = () => {
        console.log("[NativeCapture] WebSocket connected");
      };

      ws.onmessage = async (event: MessageEvent) => {
        if (!runningRef.current) return;

        try {
          // Receive raw JPEG as ArrayBuffer → Blob → createImageBitmap (GPU-accelerated)
          const blob = new Blob([event.data], { type: "image/jpeg" });
          const bitmap = await createImageBitmap(blob);

          // Adjust canvas to match actual frame dimensions on first frame
          if (firstFrame) {
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
            firstFrame = false;
            resolve(); // Signal that first frame arrived
          }

          ctx.drawImage(bitmap, 0, 0);
          bitmap.close();
        } catch {
          // Silently skip corrupt frames
        }
      };

      ws.onerror = (err) => {
        console.error("[NativeCapture] WebSocket error:", err);
        resolve(); // Don't hang if connection fails
      };

      ws.onclose = () => {
        console.log("[NativeCapture] WebSocket closed");
        runningRef.current = false;
      };

      // Timeout: if no frame arrives within 5s, resolve anyway
      setTimeout(resolve, 5000);
    });

    // Wait for the first frame to arrive so canvas dimensions are set
    await framePromise;

    // Create MediaStream from canvas
    const stream = canvas.captureStream(options.fps);

    // If withAudio, try to capture system audio via getDisplayMedia
    // Note: this will show a brief OS picker for audio only — but users
    // can just click "Entire Screen" and it captures audio.
    // The video track from this is immediately stopped.
    if (options.withAudio) {
      try {
        const audioStream = await navigator.mediaDevices.getDisplayMedia({
          video: { width: 1, height: 1 }, // minimal video (required by spec)
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          } as any,
        });
        const audioTrack = audioStream.getAudioTracks()[0];
        if (audioTrack) {
          stream.addTrack(audioTrack);
        }
        // Stop the video track from getDisplayMedia (we only wanted audio)
        audioStream.getVideoTracks().forEach(t => t.stop());
      } catch {
        console.warn("[NativeCapture] System audio capture not available");
      }
    }

    streamRef.current = stream;
    return stream;
  }, []);

  /**
   * Stop the native capture loop and release resources.
   */
  const stopCapture = useCallback(async () => {
    runningRef.current = false;

    // Close WebSocket connection
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch { /* ignore */ }
      wsRef.current = null;
    }

    // Stop Rust capture server
    if (isTauri()) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("stop_capture_server");
      } catch { /* ignore */ }
    }

    // Stop all tracks
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }

    canvasRef.current = null;
  }, []);

  return { startCapture, stopCapture };
}
