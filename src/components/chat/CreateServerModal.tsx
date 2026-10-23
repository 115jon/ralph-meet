import { Button } from "@/components/ui/button";
import { DialogPortal, DialogSurface } from "@/components/ui/dialog";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { IconButton } from "@/components/ui/IconButton";
import { Input } from "@/components/ui/input";
import { apiUpload } from "@/lib/api-client";
import { useChatActions } from "@/stores/chat-store";
import { useCallback, useEffect, useReducer, useRef } from "react";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
interface Props {
  open: boolean;
  onClose: () => void;
}

interface State {
  name: string;
  creating: boolean;
  iconFile: File | null;
  iconPreview: string | null;
  uploadError: string | null;
}

type Action =
  | { type: "SET_NAME"; payload: string }
  | { type: "SET_CREATING"; payload: boolean }
  | { type: "SET_ICON"; file: File; preview: string }
  | { type: "SET_UPLOAD_ERROR"; payload: string | null }
  | { type: "RESET_ICON" };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "SET_NAME":
      return { ...state, name: action.payload };
    case "SET_CREATING":
      return { ...state, creating: action.payload };
    case "SET_ICON":
      return {
        ...state,
        iconFile: action.file,
        iconPreview: action.preview,
        uploadError: null,
      };
    case "SET_UPLOAD_ERROR":
      return { ...state, uploadError: action.payload };
    case "RESET_ICON":
      return { ...state, iconFile: null, iconPreview: null, uploadError: null };
    default:
      return state;
  }
}

export default function CreateServerModal({ open, onClose }: Props) {
  const { createServer, dispatch: chatDispatch } = useChatActions();
  const [state, dispatch] = useReducer(reducer, {
    name: "",
    creating: false,
    iconFile: null,
    iconPreview: null,
    uploadError: null,
  });

  const isMobile = useIsMobile();
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

  const handleIconSelect = useCallback(
    (file: File) => {
      // Validate type
      if (!file.type.startsWith("image/")) {
        dispatch({
          type: "SET_UPLOAD_ERROR",
          payload: "Only image files are allowed",
        });
        return;
      }
      // Validate size (8MB)
      if (file.size > 8 * 1024 * 1024) {
        dispatch({
          type: "SET_UPLOAD_ERROR",
          payload: "Image too large (max 8MB)",
        });
        return;
      }

      // Create local preview
      if (state.iconPreview) URL.revokeObjectURL(state.iconPreview);
      dispatch({ type: "SET_ICON", file, preview: URL.createObjectURL(file) });
    },
    [state.iconPreview],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) handleIconSelect(file);
    },
    [handleIconSelect],
  );

  const handleCreate = useCallback(async () => {
    if (!state.name.trim() || state.creating) return;
    dispatch({ type: "SET_CREATING", payload: true });
    dispatch({ type: "SET_UPLOAD_ERROR", payload: null });

    try {
      let iconUrl: string | undefined;

      // Upload icon first if selected
      if (state.iconFile) {
        const formData = new FormData();
        formData.append("file", state.iconFile);

        try {
          const data = await apiUpload<{ url: string }>(
            "/api/servers/icon-upload",
            formData,
          );
          iconUrl = data.url;
        } catch (err) {
          dispatch({
            type: "SET_UPLOAD_ERROR",
            payload: (err as Error).message || "Failed to upload icon",
          });
          dispatch({ type: "SET_CREATING", payload: false });
          return;
        }
      }

      const server = await createServer(state.name.trim(), iconUrl);
      if (server) {
        chatDispatch({ type: "SET_ACTIVE_SERVER", serverId: server.id });
        onClose();
      }
    } catch {
      dispatch({ type: "SET_UPLOAD_ERROR", payload: "Something went wrong" });
    }
    dispatch({ type: "SET_CREATING", payload: false });
  }, [
    state.name,
    state.creating,
    state.iconFile,
    createServer,
    chatDispatch,
    onClose,
  ]);

  const fields = (
    <>
      {/* Icon upload */}
      <div className="mb-5 flex justify-center">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          className="group relative flex h-20 w-20 cursor-pointer items-center justify-center overflow-hidden rounded-full border-2 border-dashed border-rm-border bg-rm-bg-surface transition-ui pointer-fine:hover:border-primary/50 pointer-fine:hover:bg-rm-bg-elevated"
        >
          {state.iconPreview ? (
            <>
              <img
                src={state.iconPreview}
                alt="Server icon preview"
                className="h-full w-full object-cover"
              />
              <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                <span className="text-ui-2xs font-bold uppercase text-white">
                  Change
                </span>
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center gap-0.5">
              <Icon
                name="add"
                size="lg"
                className="text-rm-text-muted/40 transition-colors group-hover:text-primary"
              />
              <span className="text-ui-2xs font-semibold uppercase tracking-[0.08em] text-rm-text-muted/40 group-hover:text-primary">
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
        <p className="mb-3 text-center text-ui-xs font-medium text-destructive">
          {state.uploadError}
        </p>
      )}

      <div className="space-y-3">
        <label
          htmlFor="server-name"
          className="text-ui-2xs font-semibold uppercase tracking-[0.08em] text-rm-text-muted"
        >
          Server Name
        </label>
        <Input
          id="server-name"
          ref={inputRef}
          value={state.name}
          onChange={(e) =>
            dispatch({ type: "SET_NAME", payload: e.target.value })
          }
          onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          placeholder="My Awesome Server"
          className="h-10"
        />
      </div>
    </>
  );

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(nextOpen) => !nextOpen && onClose()}
    >
      {isMobile ? (
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>Create a Server</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              Your server is where you and your friends hang out.
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          {fields}
          <ResponsiveDialogFooter>
            <Button
              onClick={handleCreate}
              disabled={!state.name.trim() || state.creating}
              loading={state.creating}
            >
              Create Server
            </Button>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      ) : (
        <DialogPortal>
          <div
            data-state={open ? "open" : "closed"}
            className={cn(
              "fixed inset-0 z-50 flex items-end sm:items-center justify-center pointer-events-none transition-opacity duration-200 data-[state=closed]:opacity-0",
            )}
          >
            {/* Backdrop */}
            <button
              type="button"
              data-base-modal-backdrop
              className={cn(
                "absolute inset-0 border-0 bg-black/60 p-0 backdrop-blur-sm pointer-events-auto",
                !open && "pointer-events-none opacity-0",
              )}
              onClick={onClose}
              aria-label="Close create server modal"
            />

            {/* Modal */}
            <DialogSurface
              showCloseButton={false}
              className={cn(
                "relative z-10 w-full sm:max-w-md h-[90dvh] sm:h-auto animate-in slide-in-from-bottom-full sm:slide-in-from-bottom-0 sm:fade-in sm:zoom-in-95 rounded-t-xl sm:rounded-xl border border-rm-border bg-rm-bg-surface dark:bg-rm-bg-elevated p-6 shadow-[var(--rm-shadow-3)] duration-300 sm:duration-200 pointer-events-auto flex flex-col",
                "data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom-full sm:data-[state=closed]:slide-out-to-bottom-0 sm:data-[state=closed]:fade-out sm:data-[state=closed]:zoom-out-95",
              )}
            >
              {/* Close */}
              <IconButton
                icon="close"
                iconSize="sm"
                onClick={onClose}
                aria-label="Close"
                className="absolute right-4 top-4"
              />

              <h2 className="mb-1 text-center text-ui-lg font-semibold text-rm-text">
                Create a Server
              </h2>
              <p className="mb-6 text-center text-ui-sm font-medium text-rm-text-muted">
                Your server is where you and your friends hang out.
              </p>

              {fields}

              <div className="mt-auto sm:mt-6 pt-4 sm:pt-0 pb-6 sm:pb-0 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end shrink-0">
                <Button
                  variant="secondary"
                  onClick={onClose}
                  className="w-full sm:w-auto"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleCreate}
                  disabled={!state.name.trim() || state.creating}
                  loading={state.creating}
                  className="w-full sm:w-auto"
                >
                  Create Server
                </Button>
              </div>
            </DialogSurface>
          </div>
        </DialogPortal>
      )}
    </ResponsiveDialog>
  );
}
