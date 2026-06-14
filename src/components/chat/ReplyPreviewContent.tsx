import { ImageIcon } from "lucide-react";

type ReplyPreviewContentProps = {
  content: string;
  attachmentsCount?: number;
};

export function getReplyPreviewText(content: string, attachmentsCount = 0): string {
  const trimmed = content.trim();
  if (trimmed) return content;
  if (attachmentsCount > 0) return "Click to see attachment";
  return "(no content)";
}

export function ReplyPreviewContent({ content, attachmentsCount = 0 }: ReplyPreviewContentProps) {
  const trimmed = content.trim();

  if (trimmed) {
    return <span>{content}</span>;
  }

  if (attachmentsCount > 0) {
    return (
      <span className="inline-flex items-center gap-1 italic text-rm-text-muted align-baseline">
        <ImageIcon className="h-3.5 w-3.5 shrink-0" />
        <span>Click to see attachment</span>
      </span>
    );
  }

  return <span className="italic text-rm-text-muted">(no content)</span>;
}
