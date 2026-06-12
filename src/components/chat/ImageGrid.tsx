
import { getAuthAssetUrl } from '@/lib/platform';
import type { Attachment } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useImageViewerActions } from '@/stores/useImageViewerStore';
import { Trash2 } from 'lucide-react';
import { GifProviderBranding } from './GifProviderBranding';

import React from 'react';

interface DeleteButtonProps {
  id: string;
  onDelete: (id: string) => void;
}

const DeleteButton: React.FC<DeleteButtonProps> = ({ id, onDelete }) => {
  return (
    <div className="absolute top-1 right-1 opacity-0 group-hover/att:opacity-100 transition-opacity z-20">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (window.confirm('Delete this attachment?')) {
            onDelete(id);
          }
        }}
        className="p-1.5 bg-black/50 hover:bg-rose-500 text-white/80 hover:text-white rounded-lg transition-all backdrop-blur-sm shadow-sm"
        aria-label="Delete image"
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
};

interface ImageGridProps {
  attachments: Attachment[];
  onDelete?: (attachmentId: string) => void;
  username?: string;
  avatarUrl?: string | null;
  createdAt?: string;
}

export const ImageGrid: React.FC<ImageGridProps> = ({ attachments, onDelete, username, avatarUrl, createdAt }) => {
  const count = attachments.length;
  const { open } = useImageViewerActions();

  const handleOpen = (idx: number) => {
    open(attachments, idx, {
      username,
      avatar_url: avatarUrl,
      created_at: createdAt
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent, idx: number) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleOpen(idx);
    }
  };

  if (count === 0) return null;

  // Resolve URL — use `url` if available, otherwise build from file_key
  const getUrl = (att: Attachment) => getAuthAssetUrl(att.url || `/api/${att.file_key}`);

  if (count === 1) {
    const att = attachments[0];
    const url = getUrl(att);
    return (
      <div
        className="w-fit rounded-xl overflow-hidden border border-rm-border group/att relative shadow-xl hover:shadow-primary/5 transition-all cursor-zoom-in"
        onClick={() => handleOpen(0)}
        onKeyDown={(e) => handleKeyDown(e, 0)}
        role="button"
        tabIndex={0}
      >
        <img
          src={url}
          alt={att.filename}
          width={800}
          height={450}
          className="max-w-full max-h-[450px] w-auto h-auto object-contain hover:brightness-105 transition-all"
        />
        <GifProviderBranding fileKeyOrUrl={att.file_key || att.url} />
        {onDelete && <DeleteButton id={att.id} onDelete={onDelete} />}
      </div>
    );
  }

  // Multi-image container settings
  const containerClasses = "grid gap-1 rounded-xl overflow-hidden max-w-[550px] border border-rm-border shadow-xl bg-rm-bg-elevated";

  // 2 Images: Two vertical columns
  if (count === 2) {
    return (
      <div className={cn(containerClasses, "grid-cols-2 h-[300px]")}>
        {attachments.map((att, idx) => {
          const url = getUrl(att);
          return (
            <div
              key={att.id}
              className="h-full w-full overflow-hidden group/att relative bg-rm-bg-primary/50 cursor-zoom-in"
              onClick={() => handleOpen(idx)}
              onKeyDown={(e) => handleKeyDown(e, idx)}
              role="button"
              tabIndex={0}
            >
              <img
                src={url}
                alt={att.filename}
                width={300}
                height={300}
                className="w-full h-full object-cover hover:brightness-105 transition-all duration-500"
              />
              <GifProviderBranding fileKeyOrUrl={att.file_key || att.url} />
              {onDelete && <DeleteButton id={att.id} onDelete={onDelete} />}
            </div>
          );
        })}
      </div>
    );
  }

  // 3 Images: 1 large on left, 2 stacked on right
  if (count === 3) {
    return (
      <div className={cn(containerClasses, "grid-cols-2 grid-rows-2 h-[350px]")}>
        {[0, 1, 2].map((idx) => {
          const att = attachments[idx];
          const url = getUrl(att);
          return (
            <div
              key={att.id}
              className={cn(
                "overflow-hidden group/att relative bg-[#0a0a0c] cursor-zoom-in",
                idx === 0 && "row-span-2"
              )}
              onClick={() => handleOpen(idx)}
              onKeyDown={(e) => handleKeyDown(e, idx)}
              role="button"
              tabIndex={0}
            >
              <img
                src={url}
                alt={att.filename}
                width={idx === 0 ? 350 : 250}
                height={idx === 0 ? 350 : 175}
                className="w-full h-full object-cover hover:brightness-105 transition-all duration-500"
              />
              <GifProviderBranding fileKeyOrUrl={att.file_key || att.url} />
              {onDelete && <DeleteButton id={att.id} onDelete={onDelete} />}
            </div>
          );
        })}
      </div>
    );
  }

  // 4 Images: balanced 2x2
  if (count === 4) {
    return (
      <div className={cn(containerClasses, "grid-cols-2 grid-rows-2 h-[400px]")}>
        {attachments.map((att, idx) => {
          const url = getUrl(att);
          return (
            <div
              key={att.id}
              className="h-full w-full overflow-hidden group/att relative bg-rm-bg-primary/50 cursor-zoom-in"
              onClick={() => handleOpen(idx)}
              onKeyDown={(e) => handleKeyDown(e, idx)}
              role="button"
              tabIndex={0}
            >
              <img
                src={url}
                alt={att.filename}
                width={250}
                height={200}
                className="w-full h-full object-cover hover:brightness-105 transition-all duration-500"
              />
              <GifProviderBranding fileKeyOrUrl={att.file_key || att.url} />
              {onDelete && <DeleteButton id={att.id} onDelete={onDelete} />}
            </div>
          );
        })}
      </div>
    );
  }

  // 5 Images: 2 top, 3 bottom (Discord logic)
  if (count === 5) {
    return (
      <div className={cn(containerClasses, "grid-cols-6")}>
        {attachments.map((att, idx) => {
          const url = getUrl(att);
          return (
            <div
              key={att.id}
              onClick={() => handleOpen(idx)}
              onKeyDown={(e) => handleKeyDown(e, idx)}
              role="button"
              tabIndex={0}
              className={cn(
                "h-full w-full overflow-hidden group/att relative bg-[#0a0a0c] cursor-zoom-in",
                idx < 2 ? "col-span-3 aspect-video" : "col-span-2 aspect-square"
              )}
            >
              <img
                src={url}
                alt={att.filename}
                width={idx < 2 ? 300 : 200}
                height={idx < 2 ? 170 : 200}
                className="w-full h-full object-cover hover:brightness-105 transition-all duration-500"
              />
              <GifProviderBranding fileKeyOrUrl={att.file_key || att.url} />
              {onDelete && <DeleteButton id={att.id} onDelete={onDelete} />}
            </div>
          );
        })}
      </div>
    );
  }

  // 6+ Images: 1 big top row, 3-column rows below (Discord Feature Grid)
  const displayCount = Math.min(count, 10);

  return (
    <div className={cn(containerClasses, "grid-cols-3")}>
      {attachments.slice(0, displayCount).map((att, idx) => {
        const isFirst = idx === 0;
        const isLastVisible = idx === 9;
        const hasMore = count > 10;
        const url = getUrl(att);

        return (
          <div
            key={att.id}
            onClick={() => handleOpen(idx)}
            onKeyDown={(e) => handleKeyDown(e, idx)}
            role="button"
            tabIndex={0}
            className={cn(
              "h-full w-full overflow-hidden group/att relative bg-[#0a0a0c] cursor-zoom-in",
              isFirst ? "col-span-3 h-[250px]" : "col-span-1 aspect-square"
            )}
          >
            <img
              src={url}
              alt={att.filename}
              width={isFirst ? 550 : 180}
              height={isFirst ? 250 : 180}
              className="w-full h-full object-cover hover:brightness-105 transition-all duration-500"
            />
            <GifProviderBranding fileKeyOrUrl={att.file_key || att.url} />
            {onDelete && <DeleteButton id={att.id} onDelete={onDelete} />}
            {isLastVisible && hasMore && (
              <div className="absolute inset-0 bg-black/60 flex items-center justify-center backdrop-blur-[2px] pointer-events-none">
                <span className="text-2xl font-black text-white">+{count - 10}</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
