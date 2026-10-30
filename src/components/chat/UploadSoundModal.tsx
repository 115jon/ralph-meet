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
import { FIELD as INPUT_FIELD, Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Num } from "@/components/ui/num";
import { cn } from "@/lib/utils";

import EmojiToken from "./EmojiToken";
import { RangeSlider } from "./floating/RangeSlider";

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

  // Field anatomy: label above, gap-2, the Input edge at 32px (40 on
  // phones) for the file and emoji pickers too.
  const FIELD = cn(
    INPUT_FIELD,
    "flex h-8 items-center text-ui-row max-md:h-10 max-md:text-ui-md",
  );
  const required = (
    <span aria-hidden className="text-danger-ink">
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
              "cursor-pointer justify-between gap-2 py-0.5 pr-0.5 pl-2.5 has-[input:focus-visible]:border-focus has-[input:focus-visible]:outline-1 has-[input:focus-visible]:outline-offset-0 has-[input:focus-visible]:outline-focus pointer-fine:hover:border-line-strong",
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
            <span
              className={cn(
                "flex min-w-0 items-center gap-2",
                file ? "text-ink-1" : "text-ink-3",
              )}
            >
              <Icon name="upload" size="sm" className="shrink-0" />
              <span className="truncate">
                {file ? file.name : "Choose an audio file"}
              </span>
            </span>
            <span
              aria-hidden
              className="flex h-6 shrink-0 items-center rounded-sm bg-tint-2 px-2 text-ui-sm font-medium text-ink-1 max-md:h-8"
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
            className="max-md:h-10"
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
              "justify-center gap-2 px-2.5 text-ink-3 focus-visible:border-focus pointer-fine:hover:border-line-strong",
            )}
            aria-haspopup="dialog"
            aria-expanded={isEmojiPickerOpen}
          >
            {relatedEmoji ? (
              <EmojiToken
                value={relatedEmoji}
                className="block size-5 object-contain"
                fallbackClassName="block text-ui-lg leading-none"
              />
            ) : (
              <>
                <Icon name="emoji" size="sm" />
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

      {/* Sound volume: the value reads beside the label, in Num. */}
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <Label htmlFor={soundVolumeInputId}>Sound volume</Label>
          <Num size="sm" className="text-ink-2" aria-hidden>
            {Math.round(soundVolume * 100)}%
          </Num>
        </div>
        <RangeSlider
          id={soundVolumeInputId}
          value={Math.round(soundVolume * 100)}
          onValueChange={(value) => setSoundVolume(value / 100)}
          aria-valuetext={`${Math.round(soundVolume * 100)}%`}
          className="h-8"
        />
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
            Cancel
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
