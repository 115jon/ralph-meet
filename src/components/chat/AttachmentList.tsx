

import { getFileIcon } from "@/lib/file-icons";
import { isPlayableVideo } from "@/lib/media";
import { Loader2, Trash2, X } from "./Icons";
import { UploadedFileInfo } from "./MessageInput";

interface PendingUpload {
  tempId: string;
  file: File;
  progress: number;
  previewUrl?: string;
  abortController: AbortController;
}

interface AttachmentListProps {
  uploadedFiles: UploadedFileInfo[];
  pendingUploads: PendingUpload[];
  onRemove: (id: string) => void;
  onCancel: (tempId: string) => void;
}

export default function AttachmentList({ uploadedFiles, pendingUploads, onRemove, onCancel }: AttachmentListProps) {
  if (uploadedFiles.length === 0 && pendingUploads.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-3 p-4 border-b border-rm-border bg-rm-bg-elevated rounded-t-2xl animate-in slide-in-from-bottom-2 duration-200">
      {uploadedFiles.map((att) => (
        <div key={att.id} className="relative w-28 h-28 rounded-xl overflow-hidden border border-rm-border group/item bg-rm-bg-floating shadow-md animate-in slide-in-from-bottom-2 duration-300">
          {att.content_type.startsWith("image/") ? (
            <img
              src={att.url}
              alt={att.filename}
              title={att.filename}
              className="w-full h-full object-cover"
            />
          ) : isPlayableVideo(att.content_type) ? (
            <div className="w-full h-full bg-black flex items-center justify-center relative">
              <video
                src={att.url}
                className="w-full h-full object-cover"
                preload="metadata"
                muted
              >
                <track kind="captions" />
              </video>
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-8 h-8 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center">
                  <svg viewBox="0 0 24 24" fill="white" className="w-4 h-4 ml-0.5">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </div>
              </div>
            </div>
          ) : (
            (() => {
              const { Icon: TypeIcon, colorClass } = getFileIcon(att.filename, att.content_type);
              return (
                <div className="w-full h-full flex flex-col items-center justify-center p-3">
                  <div className={`p-2 rounded-lg mb-2 ${colorClass} bg-rm-bg-surface`}>
                    <TypeIcon size={24} />
                  </div>
                  <span className="text-[10px] text-rm-text font-medium text-center line-clamp-2 px-1">{att.filename}</span>
                </div>
              );
            })()
          )}
          <div className="absolute top-1 right-1 opacity-0 group-hover/item:opacity-100 transition-opacity z-10">
            <button
              type="button"
              onClick={() => onRemove(att.id)}
              className="p-1.5 bg-black/50 hover:bg-destructive text-rm-text rounded-lg transition-all backdrop-blur-sm shadow-sm"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      ))}
      {pendingUploads.map((p) => (
        <div key={p.tempId} className="w-28 h-28 rounded-xl border border-rm-border bg-rm-bg-surface/50 flex flex-col items-center justify-center relative overflow-hidden group/pending shadow-lg">
          {p.previewUrl ? (
            <img
              src={p.previewUrl}
              alt="Upload preview"
              className="absolute inset-0 w-full h-full object-cover opacity-40 blur-[1px]"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center opacity-10">
              {(() => {
                const { Icon: PendingIcon } = getFileIcon(p.file.name, p.file.type);
                return <PendingIcon size={48} className="text-rm-text" />;
              })()}
            </div>
          )}
          <div className="z-10 flex flex-col items-center p-3 w-full bg-rm-bg-floating/40 backdrop-blur-sm h-full justify-center">
            <Loader2 size={24} className="text-primary animate-spin mb-2 drop-shadow-[0_0_8px_var(--rm-glow)]" />
            <span className="text-[10px] text-rm-text-secondary font-medium truncate w-full text-center px-1 mb-1">{p.file.name}</span>
          </div>
          <div className="absolute top-1 right-1 opacity-0 group-hover/pending:opacity-100 transition-opacity z-20">
            <button
              type="button"
              onClick={() => onCancel(p.tempId)}
              className="p-1.5 bg-black/50 hover:bg-destructive text-rm-text/80 hover:text-rm-text rounded-lg transition-all backdrop-blur-sm shadow-sm"
            >
              <X size={14} />
            </button>
          </div>
          <div className="absolute inset-0 bg-gradient-to-tr from-rm-bg-active/20 to-transparent pointer-events-none" />
        </div>
      ))}
    </div>
  );
}
