
import { BaseModal } from "@/components/ui/BaseModal";
import { apiUpload } from "@/lib/api-client";
import { useChatActions } from "@/stores/chat-store";
import { useCallback, useEffect, useReducer, useRef } from "react";
import { Loader2, Plus, X } from "./Icons";
import { cn } from "@/lib/utils";
interface Props {
  onClose: () => void;
  isClosing?: boolean;
}

interface State {
  name: string;
  creating: boolean;
  iconFile: File | null;
  iconPreview: string | null;
  uploadError: string | null;
}

type Action =
  | { type: 'SET_NAME'; payload: string }
  | { type: 'SET_CREATING'; payload: boolean }
  | { type: 'SET_ICON'; file: File; preview: string }
  | { type: 'SET_UPLOAD_ERROR'; payload: string | null }
  | { type: 'RESET_ICON' };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'SET_NAME':
      return { ...state, name: action.payload };
    case 'SET_CREATING':
      return { ...state, creating: action.payload };
    case 'SET_ICON':
      return { ...state, iconFile: action.file, iconPreview: action.preview, uploadError: null };
    case 'SET_UPLOAD_ERROR':
      return { ...state, uploadError: action.payload };
    case 'RESET_ICON':
      return { ...state, iconFile: null, iconPreview: null, uploadError: null };
    default:
      return state;
  }
}

export default function CreateServerModal({ onClose, isClosing }: Props) {
  const { createServer, dispatch: chatDispatch } = useChatActions();
  const [state, dispatch] = useReducer(reducer, {
    name: "",
    creating: false,
    iconFile: null,
    iconPreview: null,
    uploadError: null,
  });

  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Close on Escape
  

  

  // Clean up object URL on unmount
  useEffect(() => {
    return () => {
      if (state.iconPreview) URL.revokeObjectURL(state.iconPreview);
    };
  }, [state.iconPreview]);

  const handleIconSelect = useCallback((file: File) => {
    // Validate type
    if (!file.type.startsWith("image/")) {
      dispatch({ type: 'SET_UPLOAD_ERROR', payload: "Only image files are allowed" });
      return;
    }
    // Validate size (8MB)
    if (file.size > 8 * 1024 * 1024) {
      dispatch({ type: 'SET_UPLOAD_ERROR', payload: "Image too large (max 8MB)" });
      return;
    }

    // Create local preview
    if (state.iconPreview) URL.revokeObjectURL(state.iconPreview);
    dispatch({ type: 'SET_ICON', file, preview: URL.createObjectURL(file) });
  }, [state.iconPreview]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleIconSelect(file);
  }, [handleIconSelect]);

  const handleCreate = useCallback(async () => {
    if (!state.name.trim() || state.creating) return;
    dispatch({ type: 'SET_CREATING', payload: true });
    dispatch({ type: 'SET_UPLOAD_ERROR', payload: null });

    try {
      let iconUrl: string | undefined;

      // Upload icon first if selected
      if (state.iconFile) {
        const formData = new FormData();
        formData.append("file", state.iconFile);

        try {
          const data = await apiUpload<{ url: string }>("/api/servers/icon-upload", formData);
          iconUrl = data.url;
        } catch (err) {
          dispatch({ type: 'SET_UPLOAD_ERROR', payload: (err as Error).message || "Failed to upload icon" });
          dispatch({ type: 'SET_CREATING', payload: false });
          return;
        }
      }

      const server = await createServer(state.name.trim(), iconUrl);
      if (server) {
        chatDispatch({ type: "SET_ACTIVE_SERVER", serverId: server.id });
        onClose();
      }
    } catch {
      dispatch({ type: 'SET_UPLOAD_ERROR', payload: "Something went wrong" });
    }
    dispatch({ type: 'SET_CREATING', payload: false });
  }, [state.name, state.creating, state.iconFile, createServer, chatDispatch, onClose]);

  return (
    <BaseModal onClose={onClose}>
      <div className={cn("fixed inset-0 z-[200] flex items-end sm:items-center justify-center pointer-events-none", isClosing && "animate-out fade-out")}>
      {/* Backdrop */}
      <button
        type="button"
        className="absolute inset-0 border-0 bg-black/60 p-0 backdrop-blur-sm pointer-events-auto"
        onClick={onClose}
        aria-label="Close create server modal"
      />

      {/* Modal */}
      <div className={cn("relative z-10 w-full sm:max-w-md h-[90vh] sm:h-auto animate-in slide-in-from-bottom-full sm:slide-in-from-bottom-0 sm:fade-in sm:zoom-in-95 rounded-t-[24px] sm:rounded-2xl border border-rm-border bg-rm-bg-primary p-6 shadow-2xl duration-300 sm:duration-200 pointer-events-auto flex flex-col", isClosing && "animate-out slide-out-to-bottom-full sm:slide-out-to-bottom-0 sm:fade-out sm:zoom-out-95")}>
        {/* Mobile drag handle */}
        <div className="w-full flex justify-center pb-6 sm:hidden shrink-0 mt-[-10px]">
          <div className="w-12 h-1.5 rounded-full bg-rm-bg-hover" />
        </div>
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
            {state.iconPreview ? (
              <>
                <img
                  src={state.iconPreview}
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
            aria-label="Upload server icon"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleIconSelect(file);
              e.target.value = "";
            }}
          />
        </div>

        {state.uploadError && (
          <p className="mb-3 text-center text-xs font-medium text-red-800 dark:text-red-400">{state.uploadError}</p>
        )}

        <div className="space-y-3">
          <label htmlFor="server-name" className="text-[11px] font-bold uppercase tracking-widest text-rm-text-muted/40">
            Server Name
          </label>
          <input
            id="server-name"
            ref={inputRef}
            value={state.name}
            onChange={(e) => dispatch({ type: 'SET_NAME', payload: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            placeholder="My Awesome Server"
            className="w-full rounded-xl border border-rm-border bg-rm-bg-surface px-4 py-3 text-rm-text outline-none transition-all placeholder:text-rm-text-muted/20 focus:border-primary/30 focus:ring-2 focus:ring-primary/20"
          />
        </div>

        <div className="mt-auto sm:mt-6 pt-4 sm:pt-0 pb-6 sm:pb-0 flex flex-col-reverse sm:flex-row justify-end gap-3 shrink-0">
          <button
            onClick={onClose}
            className="w-full sm:w-auto rounded-xl px-4 py-3 sm:py-2.5 text-[15px] sm:text-sm font-bold text-rm-text-muted transition-colors hover:text-rm-text hover:bg-rm-bg-hover outline-none"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!state.name.trim() || state.creating}
            className="w-full sm:w-auto flex justify-center items-center gap-2 rounded-xl bg-primary px-5 py-3 sm:py-2.5 text-[15px] sm:text-sm font-bold text-primary-foreground shadow-lg shadow-primary/20 transition-all hover:brightness-110 disabled:opacity-40"
          >
            {state.creating && <Loader2 className="h-4 w-4 sm:h-3.5 sm:w-3.5 animate-spin" />}
            {state.creating ? "Creating…" : "Create Server"}
          </button>
        </div>
      </div>
    </div>
    </BaseModal>
  );
}
