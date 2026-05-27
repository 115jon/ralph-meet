import type { Attachment, EmbedInfo } from "@/lib/types";
import { Radio } from "lucide-react";
import { useEffect, useState } from "react";
import ShareSnapshotPreview from "./ShareSnapshotPreview";

export interface PublicShare {
  token: string;
  expires_at: string | null;
  allow_indexing: boolean;
  original_edited: boolean;
  snapshot: {
    content: string;
    author: {
      username: string;
      display_name: string | null;
      avatar_url: string | null;
    };
    attachments: Attachment[];
    omitted_attachment_count: number;
    embeds: EmbedInfo[];
    reactions: Array<{ emoji: string; count: number }>;
    reply_count: number;
    created_at: string;
    source?: { server_name: string | null; channel_name: string | null };
  };
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function avatarUrl(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  return value;
}

function publicMediaUrl(token: string, attachment: Attachment): string {
  return `/api/shared-messages/${token}/media/${attachment.file_key.replace(/^attachments\//, "")}`;
}

interface SharedMessagePageProps {
  token: string;
  initialShare?: PublicShare | null;
  initialGone?: boolean;
}

export default function SharedMessagePage({ token, initialShare = null, initialGone = false }: SharedMessagePageProps) {
  const [share, setShare] = useState<PublicShare | null>(initialShare);
  const [gone, setGone] = useState(initialGone);
  const [loading, setLoading] = useState(!initialShare && !initialGone);

  useEffect(() => {
    if (initialShare || initialGone) return;
    let cancelled = false;
    fetch(`/api/shared-messages/${token}`)
      .then(async (response) => {
        if (!response.ok) {
          const error = new Error("Failed to load share") as Error & { status?: number };
          error.status = response.status;
          throw error;
        }
        return response.json() as Promise<{ share: PublicShare }>;
      })
      .then((data) => {
        if (!cancelled) setShare(data.share);
      })
      .catch((error: any) => {
        if (!cancelled && error?.status === 410) setGone(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [initialGone, initialShare, token]);

  return (
    <main className="min-h-screen bg-rm-bg-primary text-rm-text">
      <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-5 py-8 sm:py-14">
        <header className="mb-8 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-rm-border bg-rm-bg-elevated">
            <Radio className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="text-sm font-bold text-rm-text">Ralph Meet</p>
            <p className="text-xs text-rm-text-muted">Shared message snapshot</p>
          </div>
        </header>

        {loading ? (
          <div className="rounded-lg border border-rm-border bg-rm-bg-surface p-6 text-sm text-rm-text-muted">
            Loading shared message...
          </div>
        ) : gone || !share ? (
          <div className="rounded-lg border border-rm-border bg-rm-bg-surface p-6">
            <h1 className="mb-2 text-xl font-bold">This share is gone</h1>
            <p className="text-sm leading-6 text-rm-text-muted">
              The message snapshot was deleted, revoked, or expired.
            </p>
          </div>
        ) : (
          <div>
            <ShareSnapshotPreview
              content={share.snapshot.content}
              author={share.snapshot.author}
              createdAt={share.snapshot.created_at}
              attachments={share.snapshot.attachments}
              omittedAttachmentCount={share.snapshot.omitted_attachment_count}
              embeds={share.snapshot.embeds}
              reactions={share.snapshot.reactions}
              replyCount={share.snapshot.reply_count}
              source={share.snapshot.source}
              originalEdited={share.original_edited}
              avatarUrl={avatarUrl(share.snapshot.author.avatar_url)}
              mediaUrlForAttachment={(attachment) => publicMediaUrl(token, attachment)}
            />

            <footer className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-rm-border pt-4 text-xs text-rm-text-muted">
              <span>{share.expires_at ? `Expires ${formatDate(share.expires_at)}` : "Permanent share"}</span>
              <a href="mailto:abuse@115jon.site" className="font-semibold text-primary hover:underline">
                Report this share
              </a>
            </footer>
          </div>
        )}
      </div>
    </main>
  );
}
