import { useState, useRef, Suspense, lazy } from "react";
import { Upload, X, Smile, Loader2 } from "lucide-react";
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
  isClosing?: boolean;
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

export function UploadSoundModal({ onClose, onUpload, isUploading, editSound, isClosing }: UploadSoundModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [soundName, setSoundName] = useState(editSound?.name ?? "");
  const [relatedEmoji, setRelatedEmoji] = useState<string | null>(editSound?.emoji ?? null);
  const [soundVolume, setSoundVolume] = useState(editSound?.volume ?? 1.0);
  const [isEmojiPickerOpen, setIsEmojiPickerOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const emojiBtnRef = useRef<HTMLButtonElement>(null);

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
    await onUpload({ file, soundId: editSound?.id, soundName, relatedEmoji, soundVolume });
  };

  const isEditMode = !!editSound;

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 dark:bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-[480px] max-w-[90vw] rounded-2xl border border-rm-border bg-rm-bg-surface shadow-2xl p-6 relative">
        <button
          onClick={onClose}
          className="absolute top-5 right-5 text-rm-text-muted hover:text-rm-text transition-colors"
        >
          <X size={20} />
        </button>

        <h2 className="text-xl font-bold text-rm-text mb-6">{isEditMode ? "Edit Sound" : "Upload a Sound"}</h2>

        <div className="space-y-5">
          {/* File Input */}
          {!isEditMode && (
            <div>
              <label className="block text-[13px] font-bold text-rm-text mb-2">
                File <span className="text-red-500 dark:text-red-400">*</span>
              </label>
              <div 
                className="flex items-center justify-between border border-rm-border bg-rm-bg-hover rounded-xl p-1 pl-3 cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => fileInputRef.current?.click()}
              >
                <div className="flex items-center gap-2 text-rm-text-muted truncate pr-2">
                  <Upload size={16} />
                  <span className="text-sm truncate">{file ? file.name : "Choose a file"}</span>
                </div>
                <div className="bg-rm-bg-active hover:bg-rm-bg-floating text-rm-text text-sm font-semibold px-4 py-2 rounded-lg transition-colors shrink-0 border border-rm-border">
                  Browse
                </div>
              </div>
              <input 
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
              <label className="block text-[13px] font-bold text-rm-text mb-2">
                Sound Name <span className="text-red-500 dark:text-red-400">*</span>
              </label>
              <input
                type="text"
                value={soundName}
                onChange={(e) => setSoundName(e.target.value)}
                placeholder="Sound Name"
                className="w-full h-11 bg-rm-bg-hover border border-rm-border rounded-xl px-4 text-sm text-rm-text outline-none focus:border-primary/50 transition-colors"
              />
            </div>

            {/* Related Emoji */}
            <div className="w-[160px] relative">
              <label className="block text-[13px] font-bold text-rm-text mb-2">
                Related Emoji
              </label>
              <button
                ref={emojiBtnRef}
                type="button"
                onClick={() => setIsEmojiPickerOpen(true)}
                className="w-full h-11 flex items-center justify-center gap-2 bg-rm-bg-hover border border-rm-border rounded-xl px-3 text-sm text-rm-text-muted hover:border-primary/50 transition-colors"
              >
                {relatedEmoji ? (
                  <EmojiToken 
                    value={relatedEmoji} 
                    className="h-6 w-6 object-contain block" 
                    fallbackClassName="text-xl leading-none block" 
                  />
                ) : (
                  <>
                    <Smile size={18} />
                    <span>Click to select</span>
                  </>
                )}
              </button>
              
              {isEmojiPickerOpen && (
                <Suspense fallback={null}>
                  <EmojiPicker
                    placement="bottom-end"
                    onClose={() => setIsEmojiPickerOpen(false)}
                    onSelect={(emoji) => {
                      setRelatedEmoji(emoji);
                      setIsEmojiPickerOpen(false);
                    }}
                    markerRef={emojiBtnRef}
                  />
                </Suspense>
              )}
            </div>
          </div>

          {/* Sound Volume */}
          <div>
            <label className="block text-[13px] font-bold text-rm-text mb-2">
              Sound Volume
            </label>
            <div className="flex items-center h-10">
              <input
                type="range"
                min="0"
                max="100"
                value={Math.round(soundVolume * 100)}
                onChange={(e) => setSoundVolume(Number(e.target.value) / 100)}
                className="w-full accent-primary h-1.5 bg-rm-border rounded-full appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-foreground [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:cursor-pointer"
              />
            </div>
          </div>
        </div>

        {/* Footer actions */}
        <div className="flex gap-3 mt-8">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-rm-border bg-rm-bg-hover hover:bg-rm-bg-active text-rm-text font-bold text-sm transition-colors"
          >
            Never mind
          </button>
          <button
            onClick={handleSubmit}
            disabled={(!file && !isEditMode) || !soundName || isUploading}
            className="flex-1 py-2.5 rounded-xl bg-[#4b55a0] hover:bg-[#5865f2] disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-sm transition-colors flex items-center justify-center gap-2"
          >
            {isUploading && <Loader2 size={16} className="animate-spin" />}
            {isEditMode ? "Save" : "Upload"}
          </button>
        </div>
      </div>
    </div>
  );
}
