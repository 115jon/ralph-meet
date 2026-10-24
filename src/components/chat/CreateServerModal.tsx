import { Button } from "@/components/ui/button";
import { describeApiError } from "@/lib/api-errors";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiUpload } from "@/lib/api-client";
import { useChatActions } from "@/stores/chat-store";
import { useCallback, useEffect, useReducer, useRef } from "react";
import { Icon } from "@/components/ui/icon";
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

  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
            payload: describeApiError(err, "upload that icon"),
          });
          dispatch({ type: "SET_CREATING", payload: false });
          return;
        }
      }

      const server = await createServer(state.name.trim(), iconUrl);
      if (server) {
        chatDispatch({ type: "SET_ACTIVE_SERVER", serverId: server.id });
        onClose();
      } else {
        dispatch({
          type: "SET_UPLOAD_ERROR",
          payload: describeApiError(null, "create the server"),
        });
      }
    } catch (err) {
      dispatch({
        type: "SET_UPLOAD_ERROR",
        payload: describeApiError(err, "create the server"),
      });
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
      <div className="flex justify-center">
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
              {/* Media overlay over the chosen image (6.5). A strip along
                  the bottom on touch, where there is no hover; the full
                  hover scrim on fine pointers. */}
              <div className="absolute inset-x-0 bottom-0 flex items-center justify-center bg-black/60 py-1 pointer-fine:inset-0 pointer-fine:bg-black/40 pointer-fine:py-0 pointer-fine:opacity-0 pointer-fine:transition-opacity pointer-fine:duration-150 pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-visible:opacity-100">
                <span className="text-ui-2xs font-semibold text-white">
                  Change
                </span>
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center gap-0.5">
              <Icon
                name="add"
                size="lg"
                className="text-rm-text-muted/40 transition-colors pointer-fine:group-hover:text-primary"
              />
              <span className="text-ui-2xs font-semibold uppercase tracking-[0.08em] text-rm-text-muted/40 pointer-fine:group-hover:text-primary">
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
        <p
          role="alert"
          className="text-center text-ui-xs font-medium text-rm-danger-ink"
        >
          {state.uploadError}
        </p>
      )}

      <div className="flex flex-col gap-2">
        <Label htmlFor="server-name">Server name</Label>
        <Input
          id="server-name"
          ref={inputRef}
          value={state.name}
          onChange={(e) =>
            dispatch({ type: "SET_NAME", payload: e.target.value })
          }
          onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          placeholder="My Awesome Server"
          className="max-md:min-h-11"
        />
      </div>
    </>
  );

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(nextOpen) => !nextOpen && onClose()}
    >
      <ResponsiveDialogContent
        className="md:max-w-md"
        // Desktop only: the drawer keeps focus on its surface so the phone
        // keyboard does not jump up on open.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Create a server</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Your server is where you and your friends hang out.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        {fields}
        <ResponsiveDialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            disabled={!state.name.trim() || state.creating}
            loading={state.creating}
          >
            Create server
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
