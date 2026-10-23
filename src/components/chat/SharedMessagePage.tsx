import { HomeLink, PageState } from "@/components/PageState";
import { ThemeAwareSplashLogo } from "@/components/ThemeAwareSplashLogo";
import { Button } from "@/components/ui/button";
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
      <HomeLink variant="default">Open Ralph Meet</HomeLink>
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
      <Button onClick={onRetry}>Try again</Button>
      <HomeLink>Open Ralph Meet</HomeLink>
    </PageState>
  );
}

function ShareFrame({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-dvh bg-rm-bg-primary text-rm-text">
      <div className="mx-auto flex w-full max-w-[720px] flex-col px-4 pt-[max(32px,var(--safe-area-top,0px))] pb-[max(32px,var(--safe-area-bottom,0px))] md:px-6 md:py-16">
        <header className="mb-8 flex items-center gap-3">
          <a href="/" className="flex min-h-11 items-center gap-3 rounded-md">
            <ThemeAwareSplashLogo className="size-8 select-none object-contain" />
            <span className="flex flex-col">
              <span className="text-ui-md font-semibold text-rm-text">
                Ralph Meet
              </span>
              <span className="text-ui-xs text-rm-text-muted">
                Shared message
              </span>
            </span>
          </a>
        </header>
        {children}
      </div>
    </main>
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

      <footer className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-rm-border pt-4 text-ui-xs text-rm-text-muted">
        <span>
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
          className="inline-flex min-h-11 items-center font-medium text-rm-accent-ink underline-offset-[3px] pointer-fine:hover:underline"
        >
          Report this share
        </a>
      </footer>
    </div>
  );
}

/** 14.2: skeleton at the real card's geometry while the share loads. */
function ShareSkeleton() {
  return (
    <div
      aria-busy="true"
      className="rounded-lg border border-rm-border bg-rm-bg-surface p-4"
    >
      <span className="sr-only" role="status">
        Loading shared message
      </span>
      <div
        aria-hidden="true"
        className="animate-pulse motion-reduce:animate-none"
      >
        <div className="mb-3 flex items-center gap-3">
          <div className="size-10 rounded-full bg-rm-tint-1" />
          <div className="flex flex-col gap-2">
            <div className="h-3 w-32 rounded-md bg-rm-tint-1" />
            <div className="h-3 w-20 rounded-md bg-rm-tint-1" />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <div className="h-4 w-full rounded-md bg-rm-tint-1" />
          <div className="h-4 w-4/5 rounded-md bg-rm-tint-1" />
          <div className="h-4 w-3/5 rounded-md bg-rm-tint-1" />
        </div>
      </div>
    </div>
  );
}
