"use client";

import { useChatActions } from "@/lib/chat-context";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, X } from "./Icons";

interface Props {
  onClose: () => void;
}

export default function CreateServerModal({ onClose }: Props) {
  const { createServer, dispatch } = useChatActions();
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleCreate = useCallback(async () => {
    if (!name.trim() || creating) return;
    setCreating(true);
    const server = await createServer(name.trim());
    if (server) {
      dispatch({ type: "SET_ACTIVE_SERVER", serverId: server.id });
      onClose();
    }
    setCreating(false);
  }, [name, creating, createServer, dispatch, onClose]);

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
