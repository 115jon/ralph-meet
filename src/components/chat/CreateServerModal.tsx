"use client";

import { useChatActions } from "@/stores/chat-store";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, Plus, X } from "./Icons";

interface Props {
  onClose: () => void;
}

export default function CreateServerModal({ onClose }: Props) {
  const { createServer, dispatch } = useChatActions();
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [iconFile, setIconFile] = useState<File | null>(null);
  const [iconPreview, setIconPreview] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // Clean up object URL on unmount
  useEffect(() => {
    return () => {
      if (iconPreview) URL.revokeObjectURL(iconPreview);
    };
  }, [iconPreview]);

  const handleIconSelect = useCallback((file: File) => {
    // Validate type
    if (!file.type.startsWith("image/")) {
      setUploadError("Only image files are allowed");
      return;
    }
    // Validate size (8MB)
    if (file.size > 8 * 1024 * 1024) {
      setUploadError("Image too large (max 8MB)");
      return;
    }
    setUploadError(null);
    setIconFile(file);
    // Create local preview
    if (iconPreview) URL.revokeObjectURL(iconPreview);
    setIconPreview(URL.createObjectURL(file));
  }, [iconPreview]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleIconSelect(file);
  }, [handleIconSelect]);

  const handleCreate = useCallback(async () => {
    if (!name.trim() || creating) return;
    setCreating(true);
    setUploadError(null);

    try {
      let iconUrl: string | undefined;

      // Upload icon first if selected
      if (iconFile) {
        const formData = new FormData();
        formData.append("file", iconFile);

        // NOTE: We keep raw fetch here because we are sending FormData,
        // and our api-client explicitly expects JSON bodies.
        const uploadRes = await fetch("/api/servers/icon-upload", {
          method: "POST",
          body: formData,
        });
        if (!uploadRes.ok) {
          const err = await uploadRes.json().catch(() => ({}));
          setUploadError((err as { error?: string }).error ?? "Failed to upload icon");
          setCreating(false);
          return;
        }
        const data = await uploadRes.json() as { url: string };
        iconUrl = data.url;
      }

      const server = await createServer(name.trim(), iconUrl);
      if (server) {
        dispatch({ type: "SET_ACTIVE_SERVER", serverId: server.id });
        onClose();
      }
    } catch {
      setUploadError("Something went wrong");
    }
    setCreating(false);
  }, [name, creating, iconFile, createServer, dispatch, onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onClose(); }}
        role="button"
        tabIndex={-1}
        aria-hidden="true"
      />

      {/* Modal */}
      <div className="relative z-10 w-full max-w-md animate-in fade-in zoom-in-95 rounded-2xl border border-rm-border bg-rm-bg-primary p-6 shadow-2xl duration-200">
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-lg p-1.5 text-rm-text-muted/40 transition-colors hover:text-rm-text outline-none"
        >
          <X className="h-4 w-4" />
        </button>

        <h2 className="mb-1 text-center text-xl font-bold text-rm-text">Create a Server</h2>
        <p className="mb-6 text-center text-sm font-medium text-rm-text-muted">
          Your server is where you and your friends hang out.
        </p>

        {/* Icon upload */}
        <div className="mb-5 flex justify-center">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            className="group relative flex h-20 w-20 cursor-pointer items-center justify-center overflow-hidden rounded-full border-2 border-dashed border-rm-border bg-rm-bg-surface transition-all hover:border-primary/50 hover:bg-rm-bg-elevated"
          >
            {iconPreview ? (
              <>
                <img
                  src={iconPreview}
                  alt="Server icon preview"
                  className="h-full w-full object-cover"
                />
                <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                  <span className="text-[10px] font-bold uppercase text-white">Change</span>
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center gap-0.5">
                <Plus className="h-5 w-5 text-rm-text-muted/40 transition-colors group-hover:text-primary" />
                <span className="text-[9px] font-bold uppercase tracking-wider text-rm-text-muted/40 group-hover:text-primary">
                  Icon
                </span>
              </div>
            )}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp,image/avif"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleIconSelect(file);
              // Reset so re-selecting same file triggers change
              e.target.value = "";
            }}
          />
        </div>

        {uploadError && (
          <p className="mb-3 text-center text-xs font-medium text-red-400">{uploadError}</p>
        )}

        <div className="space-y-3">
          <label htmlFor="server-name" className="text-[11px] font-bold uppercase tracking-widest text-rm-text-muted/40">
            Server Name
          </label>
          <input
            id="server-name"
            ref={inputRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            placeholder="My Awesome Server"
            className="w-full rounded-xl border border-rm-border bg-rm-bg-surface px-4 py-3 text-rm-text outline-none transition-all placeholder:text-rm-text-muted/20 focus:border-primary/30 focus:ring-2 focus:ring-primary/20"
          />
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="rounded-xl px-4 py-2.5 text-sm font-medium text-rm-text-muted/60 transition-colors hover:text-rm-text outline-none"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!name.trim() || creating}
            className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition-all hover:brightness-110 disabled:opacity-40"
          >
            {creating && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {creating ? "Creating…" : "Create Server"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
