import {
  PublicFrame,
  PublicKicker,
  PublicTitle,
} from "@/components/auth/PublicFrame";
import { HomeLink, PageState } from "@/components/PageState";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getAbuseEmail } from "@/lib/platform";
import type { Attachment, EmbedInfo } from "@/lib/types";
import { useClientDateFormatter } from "@/lib/client-date-format";
import { useEffect, useState, type ReactNode } from "react";
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
      avatar_display?: string | null;
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

function avatarUrl(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  return value;
}

function publicMediaUrl(token: string, attachment: Attachment): string {
  return `/api/shared-messages/${token}/media/${attachment.file_key.replace(/^attachments\//, "")}`;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "loaded"; share: PublicShare }
  | { kind: "gone" }
  | { kind: "error" };

interface SharedMessagePageProps {
  token: string;
  initialShare?: PublicShare | null;
  initialGone?: boolean;
}

export default function SharedMessagePage({
  token,
  initialShare = null,
  initialGone = false,
}: SharedMessagePageProps) {
  const [state, setState] = useState<LoadState>(() =>
    initialShare
      ? { kind: "loaded", share: initialShare }
      : initialGone
        ? { kind: "gone" }
        : { kind: "loading" },
  );
  const [attempt, setAttempt] = useState(0);
  const needsFetch = !initialShare && !initialGone;

  useEffect(() => {
    if (!needsFetch) return;
    let cancelled = false;
    fetch(`/api/shared-messages/${token}`)
      .then(async (response) => {
        if (cancelled) return;
        if (response.status === 404 || response.status === 410) {
          setState({ kind: "gone" });
          return;
        }
        if (!response.ok) {
          setState({ kind: "error" });
          return;
        }
        const data = (await response.json()) as { share?: PublicShare };
        if (cancelled) return;
        setState(
          data.share ? { kind: "loaded", share: data.share } : { kind: "gone" },
        );
      })
      .catch(() => {
        if (!cancelled) setState({ kind: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [needsFetch, token, attempt]);

  if (state.kind === "gone") return <ShareGone />;
  if (state.kind === "error") {
    return (
      <ShareError
        onRetry={() => {
          setState({ kind: "loading" });
          setAttempt((n) => n + 1);
        }}
      />
    );
  }

  return (
    <ShareFrame>
      {state.kind === "loading" ? (
        <ShareSkeleton />
      ) : (
        <LoadedShare token={token} share={state.share} />
      )}
    </ShareFrame>
  );
}

/** 14.1: the share was deleted, revoked or expired. One way forward. */
export function ShareGone() {
  return (
    <PageState
      icon="linkBroken"
      title="This shared message is gone"
      body="The person who shared it removed the link, or it expired."
    >
      <HomeLink variant="primary">Open Ralph Meet</HomeLink>
    </PageState>
  );
}

/** 14.3: anything other than "gone" is a load failure, so offer a retry. */
export function ShareError({ onRetry }: { onRetry: () => void }) {
  return (
    <PageState
      icon="alert"
      tone="danger"
      title="Couldn't load this message"
      body="Check your connection and try again."
    >
      <Button size="lg" onClick={onRetry}>
        Try again
      </Button>
      <HomeLink>Open Ralph Meet</HomeLink>
    </PageState>
  );
}

function ShareFrame({ children }: { children: ReactNode }) {
  return (
    <PublicFrame width="wide">
      <PublicKicker>Shared from Ralph Meet</PublicKicker>
      <PublicTitle size="display">Shared message</PublicTitle>
      <div className="mt-8">{children}</div>
    </PublicFrame>
  );
}

function LoadedShare({ token, share }: { token: string; share: PublicShare }) {
  const formatDate = useClientDateFormatter();
  return (
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
        mediaUrlForAttachment={(attachment) =>
          publicMediaUrl(token, attachment)
        }
      />

      <footer className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-ui-xs text-ink-3">
        <Button asChild variant="secondary" size="lg" className="max-sm:w-full">
          <a href="/chat">Open in Ralph Meet</a>
        </Button>
        <span className="silkscreen">
          {share.expires_at
            ? `Expires ${formatDate(share.expires_at, {
                month: "short",
                day: "numeric",
                year: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}`
            : "Permanent share"}
        </span>
        <a
          href={`mailto:${getAbuseEmail()}`}
          className="ml-auto inline-flex min-h-11 items-center rounded-[2px] text-ink-3 underline decoration-line-strong underline-offset-[3px] pointer-fine:hover:text-ink-2"
        >
          Report this share
        </a>
      </footer>
    </div>
  );
}

/** 14.2: the real card's geometry as static placeholders (no pulse). */
function ShareSkeleton() {
  return (
    <div
      aria-busy="true"
      className="rounded-[2px] border border-line bg-ply-2 p-4"
    >
      <span className="sr-only" role="status">
        Loading shared message
      </span>
      <div aria-hidden="true" className="flex gap-3">
        <Skeleton className="size-8 shrink-0 rounded-avatar" />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Skeleton className="h-3.5 w-32" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
        </div>
      </div>
    </div>
  );
}
