import { useId, useState, useRef, Suspense, lazy } from "react";
import { Icon } from "@/components/ui/icon";
import { cn as _cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogPortal, DialogSurface } from "@/components/ui/dialog";
import { IconButton } from "@/components/ui/IconButton";
import { Input } from "@/components/ui/input";

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
  const titleId = useId();

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

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogPortal>
        <div
          data-state={open ? "open" : "closed"}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200 data-[state=closed]:pointer-events-none data-[state=closed]:opacity-0"
        >
          <DialogSurface
            showCloseButton={false}
            className="w-[480px] max-w-[90vw] rounded-xl border border-rm-border bg-rm-bg-surface dark:bg-rm-bg-elevated shadow-[var(--rm-shadow-3)] p-6 relative animate-in fade-in zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=closed]:zoom-out-95"
          >
            <IconButton
              icon="close"
              type="button"
              onClick={onClose}
              className="absolute top-4 right-4"
              aria-label={
                isEditMode
                  ? "Close edit sound modal"
                  : "Close upload sound modal"
              }
            />

            <h2
              id={titleId}
              className="text-ui-lg font-semibold text-rm-text mb-6"
            >
              {isEditMode ? "Edit Sound" : "Upload a Sound"}
            </h2>

            <div className="space-y-5">
              {/* File Input */}
              {!isEditMode && (
                <div>
                  <label
                    htmlFor={fileInputId}
                    className="block text-ui-sm font-bold text-rm-text mb-2"
                  >
                    File <span className="text-destructive">*</span>
                  </label>
                  <label
                    htmlFor={fileInputId}
                    className="flex items-center justify-between border border-rm-border bg-rm-bg-hover rounded-xl p-1 pl-3 cursor-pointer hover:border-primary/50 transition-colors"
                  >
                    <div className="flex items-center gap-2 text-rm-text-muted truncate pr-2">
                      <Icon name="upload" size="sm" />
                      <span className="text-sm truncate">
                        {file ? file.name : "Choose a file"}
                      </span>
                    </div>
                    <span className="bg-rm-bg-active hover:bg-rm-bg-floating text-rm-text text-sm font-semibold px-4 py-2 rounded-lg transition-colors shrink-0 border border-rm-border">
                      Browse
                    </span>
                  </label>
                  <input
                    id={fileInputId}
                    type="file"
                    accept="audio/*"
                    className="hidden"
                    ref={fileInputRef}
                    onChange={handleFileChange}
                  />
                </div>
              )}

              <div className="flex gap-4">
                {/* Sound Name */}
                <div className="flex-1">
                  <label
                    htmlFor={soundNameInputId}
                    className="block text-ui-sm font-bold text-rm-text mb-2"
                  >
                    Sound Name <span className="text-destructive">*</span>
                  </label>
                  <Input
                    id={soundNameInputId}
                    type="text"
                    value={soundName}
                    onChange={(e) => setSoundName(e.target.value)}
                    placeholder="Sound Name"
                    className="h-11"
                  />
                </div>

                {/* Related Emoji */}
                <div className="w-[160px] relative">
                  <label
                    htmlFor={emojiButtonId}
                    className="block text-ui-sm font-bold text-rm-text mb-2"
                  >
                    Related Emoji
                  </label>
                  <button
                    ref={emojiBtnRef}
                    id={emojiButtonId}
                    type="button"
                    onClick={() => setIsEmojiPickerOpen(true)}
                    className="w-full h-11 flex items-center justify-center gap-2 bg-rm-bg-hover border border-rm-border rounded-xl px-3 text-sm text-rm-text-muted hover:border-primary/50 transition-colors"
                    aria-haspopup="dialog"
                    aria-expanded={isEmojiPickerOpen}
                  >
                    {relatedEmoji ? (
                      <EmojiToken
                        value={relatedEmoji}
                        className="h-6 w-6 object-contain block"
                        fallbackClassName="text-xl leading-none block"
                      />
                    ) : (
                      <>
                        <Icon name="emoji" size="md" />
                        <span>Click to select</span>
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

              {/* Sound Volume */}
              <div>
                <label
                  htmlFor={soundVolumeInputId}
                  className="block text-ui-sm font-bold text-rm-text mb-2"
                >
                  Sound Volume
                </label>
                <div className="flex items-center h-10">
                  <input
                    id={soundVolumeInputId}
                    type="range"
                    min="0"
                    max="100"
                    value={Math.round(soundVolume * 100)}
                    onChange={(e) =>
                      setSoundVolume(Number(e.target.value) / 100)
                    }
                    className="w-full accent-primary h-1.5 bg-rm-border rounded-full appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-foreground [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:cursor-pointer"
                    aria-valuetext={`${Math.round(soundVolume * 100)}%`}
                  />
                </div>
              </div>
            </div>

            {/* Footer actions */}
            <div className="mt-8 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
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
            </div>
          </DialogSurface>
        </div>
      </DialogPortal>
    </Dialog>
  );
}
