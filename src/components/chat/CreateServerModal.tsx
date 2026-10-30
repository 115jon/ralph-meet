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
import { useCallback, useEffect, useId, useReducer, useRef } from "react";
import { Icon } from "@/components/ui/icon";

interface Props {
  open: boolean;
  onClose: () => void;
}

interface State {
  name: string;
  /** Shown under the name field after a submit with no name. */
  nameError: string | null;
  creating: boolean;
  iconFile: File | null;
  iconPreview: string | null;
  uploadError: string | null;
}

type Action =
  | { type: "SET_NAME"; payload: string }
  | { type: "SET_NAME_ERROR"; payload: string | null }
  | { type: "SET_CREATING"; payload: boolean }
  | { type: "SET_ICON"; file: File; preview: string }
  | { type: "SET_UPLOAD_ERROR"; payload: string | null }
  | { type: "RESET_ICON" };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "SET_NAME":
      return { ...state, name: action.payload, nameError: null };
    case "SET_NAME_ERROR":
      return { ...state, nameError: action.payload };
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
    nameError: null,
    creating: false,
    iconFile: null,
    iconPreview: null,
    uploadError: null,
  });

  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const ids = useId();
  const iconLabelId = `${ids}-icon-label`;
  const iconHelpId = `${ids}-icon-help`;
  const nameErrorId = `${ids}-name-error`;

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

  // Create stays enabled; an empty name is caught here, inline.
  const handleCreate = useCallback(async () => {
    if (state.creating) return;
    if (!state.name.trim()) {
      dispatch({ type: "SET_NAME_ERROR", payload: "Give your server a name." });
      inputRef.current?.focus();
      return;
    }
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
      {/* Icon upload: a labelled field, with Remove once an image is set. */}
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          aria-labelledby={iconLabelId}
          aria-describedby={iconHelpId}
          className="group relative flex size-16 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-avatar border border-dashed border-line-strong bg-ply-2 text-ink-3 outline-none transition-colors duration-(--dur-1) ease-out pointer-fine:hover:bg-tint-1 pointer-fine:hover:text-ink-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          {state.iconPreview ? (
            <>
              <img
                src={state.iconPreview}
                alt="Server icon preview"
                className="h-full w-full object-cover"
              />
              {/* Media overlay over the chosen image: a hover scrim on fine
                  pointers only (touch uses the Change button beside it). */}
              <div
                aria-hidden="true"
                className="absolute inset-0 flex items-center justify-center bg-black/48 opacity-0 transition-opacity duration-(--dur-1) ease-out pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-visible:opacity-100"
              >
                <Icon name="image" size="lg" className="text-white" />
              </div>
            </>
          ) : (
            <Icon name="image" size="lg" />
          )}
        </button>
        <div className="flex min-w-0 flex-col gap-0.5">
          <span id={iconLabelId} className="text-ui-sm font-medium text-ink-1">
            Server icon, optional
          </span>
          <span id={iconHelpId} className="text-ui-xs text-ink-3">
            PNG, JPG, GIF or WebP, up to 8 MB.
          </span>
          <div className="mt-1.5 flex items-center gap-1">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
            >
              {state.iconPreview ? "Change" : "Upload image"}
            </Button>
            {state.iconPreview ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (state.iconPreview) URL.revokeObjectURL(state.iconPreview);
                  dispatch({ type: "RESET_ICON" });
                }}
              >
                Remove
              </Button>
            ) : null}
          </div>
        </div>
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
        <p role="alert" className="text-ui-xs text-danger-ink">
          {state.uploadError}
        </p>
      )}

      <div className="flex flex-col gap-1.5">
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
          aria-invalid={state.nameError ? true : undefined}
          aria-describedby={state.nameError ? nameErrorId : undefined}
          className="max-md:min-h-11"
        />
        {state.nameError ? (
          <p id={nameErrorId} className="text-ui-xs text-danger-ink">
            {state.nameError}
          </p>
        ) : null}
      </div>
    </>
  );

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(nextOpen) => !nextOpen && onClose()}
    >
      <ResponsiveDialogContent
        size="md"
        placement="top"
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
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleCreate} loading={state.creating}>
            Create server
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
