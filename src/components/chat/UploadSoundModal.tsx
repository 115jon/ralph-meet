import { useId, useState, useRef, Suspense, lazy } from "react";
import { Icon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

import EmojiToken from "./EmojiToken";

const EmojiPicker = lazy(() => import("@/components/chat/EmojiPicker"));

export interface UploadSoundData {
  file: File | null;
  soundId?: string;
  soundName: string;
  relatedEmoji: string | null;
  soundVolume: number;
}

interface UploadSoundModalProps {
  open: boolean;
  onClose: () => void;
  onUpload: (data: UploadSoundData) => Promise<void>;
  isUploading: boolean;
  editSound?: {
    id: string;
    name: string;
    emoji?: string;
    volume?: number;
  };
}

export function UploadSoundModal({
  open,
  onClose,
  onUpload,
  isUploading,
  editSound,
}: UploadSoundModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [soundName, setSoundName] = useState(editSound?.name ?? "");
  const [relatedEmoji, setRelatedEmoji] = useState<string | null>(
    editSound?.emoji ?? null,
  );
  const [soundVolume, setSoundVolume] = useState(editSound?.volume ?? 1.0);
  const [isEmojiPickerOpen, setIsEmojiPickerOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const emojiBtnRef = useRef<HTMLButtonElement>(null);
  const fileInputId = useId();
  const soundNameInputId = useId();
  const emojiButtonId = useId();
  const soundVolumeInputId = useId();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) {
      setFile(selected);
      if (!soundName) {
        setSoundName(selected.name.replace(/\.[^.]+$/, ""));
      }
    }
  };

  const handleSubmit = async () => {
    if ((!file && !editSound) || !soundName) return;
    await onUpload({
      file,
      soundId: editSound?.id,
      soundName,
      relatedEmoji,
      soundVolume,
    });
  };

  const isEditMode = !!editSound;

  // 13.4 field anatomy: Label above, gap-2, 36px fields (44 on phones).
  const FIELD =
    "flex h-9 w-full items-center rounded-md border border-rm-field-edge bg-transparent text-ui-sm text-rm-text max-md:min-h-11";
  const required = (
    <span aria-hidden className="text-rm-danger-ink">
      *
    </span>
  );

  const fields = (
    <div className="flex flex-col gap-5">
      {/* File Input */}
      {!isEditMode && (
        <div className="flex flex-col gap-2">
          <Label htmlFor={fileInputId}>File {required}</Label>
          {/* The visible field wraps the (visually hidden) file input, so
              a click opens the picker and keyboard focus rings the field. */}
          <label
            className={cn(
              FIELD,
              "cursor-pointer justify-between gap-2 py-1 pr-1 pl-3 transition-colors duration-150 ease-(--rm-ease-out) has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-(--rm-focus) pointer-fine:hover:border-rm-border-strong",
            )}
          >
            <input
              id={fileInputId}
              type="file"
              accept="audio/*"
              required
              className="sr-only"
              ref={fileInputRef}
              onChange={handleFileChange}
            />
            <span className="flex min-w-0 items-center gap-2 text-rm-text-muted">
              <Icon name="upload" size="sm" className="shrink-0" />
              <span className="truncate">
                {file ? file.name : "Choose an audio file"}
              </span>
            </span>
            <span
              aria-hidden
              className="flex h-7 shrink-0 items-center rounded-sm bg-rm-tint-2 px-2.5 font-medium text-rm-text max-md:h-9"
            >
              Browse
            </span>
          </label>
        </div>
      )}

      <div className="flex gap-4 max-md:flex-col">
        {/* Sound name */}
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Label htmlFor={soundNameInputId}>Sound name {required}</Label>
          <Input
            id={soundNameInputId}
            type="text"
            required
            value={soundName}
            onChange={(e) => setSoundName(e.target.value)}
            placeholder="Sound name"
            className="max-md:min-h-11 max-md:text-ui-md"
          />
        </div>

        {/* Related emoji */}
        <div className="relative flex flex-col gap-2 md:w-40">
          <Label htmlFor={emojiButtonId}>Related emoji</Label>
          <button
            ref={emojiBtnRef}
            id={emojiButtonId}
            type="button"
            onClick={() => setIsEmojiPickerOpen(true)}
            className={cn(
              FIELD,
              "justify-center gap-2 px-3 text-rm-text-muted transition-colors duration-150 ease-(--rm-ease-out) pointer-fine:hover:border-rm-border-strong",
            )}
            aria-haspopup="dialog"
            aria-expanded={isEmojiPickerOpen}
          >
            {relatedEmoji ? (
              <EmojiToken
                value={relatedEmoji}
                className="block size-6 object-contain"
                fallbackClassName="block text-ui-xl leading-none"
              />
            ) : (
              <>
                <Icon name="emoji" size="md" />
                <span>Choose emoji</span>
              </>
            )}
          </button>

          <Suspense fallback={null}>
            <EmojiPicker
              open={isEmojiPickerOpen}
              placement="bottom-end"
              onClose={() => setIsEmojiPickerOpen(false)}
              onSelect={(emoji) => {
                setRelatedEmoji(emoji);
                setIsEmojiPickerOpen(false);
              }}
              markerRef={emojiBtnRef}
            />
          </Suspense>
        </div>
      </div>

      {/* Sound volume */}
      <div className="flex flex-col gap-2">
        <Label htmlFor={soundVolumeInputId}>Sound volume</Label>
        <div className="flex h-10 items-center">
          <input
            id={soundVolumeInputId}
            type="range"
            min="0"
            max="100"
            value={Math.round(soundVolume * 100)}
            onChange={(e) => setSoundVolume(Number(e.target.value) / 100)}
            className="rm-settings-range w-full"
            aria-valuetext={`${Math.round(soundVolume * 100)}%`}
          />
        </div>
      </div>
    </div>
  );

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(nextOpen) => !nextOpen && onClose()}
    >
      <ResponsiveDialogContent className="md:max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>
            {isEditMode ? "Edit sound" : "Upload a sound"}
          </ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        {fields}
        <ResponsiveDialogFooter>
          <Button type="button" variant="secondary" onClick={onClose}>
            Never mind
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={(!file && !isEditMode) || !soundName || isUploading}
            loading={isUploading}
          >
            {isEditMode ? "Save" : "Upload"}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
