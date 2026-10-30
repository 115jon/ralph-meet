/**
 * Dev-only fixtures for feedback surfaces and chat media (mounted by
 * UiFixtures). Nothing here ships.
 *
 *   fx-toast              success + persistent error toast over the chat shell
 *   fx-toast-copied       one "copied" success toast over the chat shell
 *   fx-confirm-channel    delete channel confirm (danger)
 *   fx-confirm-category   delete category confirm (danger)
 *   fx-confirm-kick       kick member confirm (danger)
 *   fx-confirm-ban        ban member with reason (danger)
 *   fx-confirm-attachment delete attachment confirm (danger)
 *   fx-confirm-error      a confirm whose request failed (inline error)
 *   fx-buttons            enabled vs disabled for every Button variant
 *   fx-image-grid         ImageGrid at 1, 2, 3, 4, 5 and 12 images
 *   fx-video              VideoAttachment: unplayable, poster fallback, loading
 */

import { useEffect, useState, type ReactNode } from "react";

import { BanMemberDialog } from "@/components/chat/BanMemberDialog";
import { ImageGrid } from "@/components/chat/ImageGrid";
import VideoAttachment from "@/components/chat/VideoAttachment";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toast";
import shareFrame from "@/components/dev/assets/share-frame.webp";
import coverCopperline from "@/components/dev/assets/cover-copperline.webp";
import coverGlasshouse from "@/components/dev/assets/cover-glasshouse.webp";
import coverNightdrive from "@/components/dev/assets/cover-nightdrive.webp";
import coverPaperboats from "@/components/dev/assets/cover-paperboats.webp";
import coverSlowfires from "@/components/dev/assets/cover-slowfires.webp";
import coverSmallhours from "@/components/dev/assets/cover-smallhours.webp";
import coverTidelines from "@/components/dev/assets/cover-tidelines.webp";
import type { Attachment } from "@/lib/types";

const noop = () => {};

export function isFeedbackFixture(surface: string) {
  return surface.startsWith("fx-");
}

export function FeedbackFixture({
  surface,
  shell,
}: {
  surface: string;
  shell: ReactNode;
}) {
  switch (surface) {
    case "fx-toast":
      return (
        <Over shell={shell}>
          <ToastFixture />
        </Over>
      );
    case "fx-toast-copied":
      return (
        <Over shell={shell}>
          <ToastFixture copiedOnly />
        </Over>
      );
    case "fx-confirm-channel":
      return (
        <Over shell={shell}>
          <ConfirmDialog
            open
            onOpenChange={noop}
            title="Delete channel"
            description="#design-crit and all of its messages will be deleted. This can't be undone."
            confirmLabel="Delete channel"
            irreversible
            onConfirm={noop}
          />
        </Over>
      );
    case "fx-confirm-category":
      return (
        <Over shell={shell}>
          <ConfirmDialog
            open
            onOpenChange={noop}
            title="Delete category"
            description="Projects will be deleted. Its channels stay and move out of the category."
            confirmLabel="Delete category"
            irreversible
            onConfirm={noop}
          />
        </Over>
      );
    case "fx-confirm-kick":
      return (
        <Over shell={shell}>
          <ConfirmDialog
            open
            onOpenChange={noop}
            title="Kick member"
            description="grace will be removed from this server. They can rejoin with an invite."
            confirmLabel="Kick"
            irreversible
            onConfirm={noop}
          />
        </Over>
      );
    case "fx-confirm-ban":
      return (
        <Over shell={shell}>
          <BanMemberDialog
            target={{ userId: "u-grace", username: "grace" }}
            onClose={noop}
            onBan={() => new Promise(noop)}
          />
        </Over>
      );
    case "fx-confirm-attachment":
      return (
        <Over shell={shell}>
          <ConfirmDialog
            open
            onOpenChange={noop}
            title="Delete attachment"
            description="This image will be removed from the message. This can't be undone."
            confirmLabel="Delete attachment"
            irreversible
            onConfirm={noop}
          />
        </Over>
      );
    case "fx-confirm-error":
      return (
        <Over shell={shell}>
          <FailingConfirm />
        </Over>
      );
    case "fx-buttons":
      return <ButtonsFixture />;
    case "fx-image-grid":
      return <ImageGridFixture />;
    case "fx-video":
      return <VideoFixture />;
    default:
      return null;
  }
}

function Over({ shell, children }: { shell: ReactNode; children: ReactNode }) {
  return (
    <div className="relative h-full w-full bg-rm-bg-primary">
      {shell}
      {children}
    </div>
  );
}

function ToastFixture({ copiedOnly = false }: { copiedOnly?: boolean }) {
  useEffect(() => {
    // After the shell lays out, so the clearance measures the composer.
    const timer = window.setTimeout(() => {
      toast.success("Message link copied", { duration: Infinity });
      if (!copiedOnly) {
        // Newest on top: the persistent error leads the stack.
        toast.error("grace.png is too large to upload", {
          description: "Files can be up to 25 MB.",
        });
      }
    }, 300);
    return () => {
      window.clearTimeout(timer);
      toast.dismiss();
    };
  }, [copiedOnly]);
  return null;
}

function FailingConfirm() {
  const [open, setOpen] = useState(true);
  // Press the confirm once on mount so the failure renders.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      // The dialog portals to <body>: find its confirm by label.
      [...document.querySelectorAll<HTMLButtonElement>("[role=dialog] button")]
        .find((b) => b.textContent === "Delete channel")
        ?.click();
    }, 400);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Delete channel"
        description="#design-crit and all of its messages will be deleted. This can't be undone."
        confirmLabel="Delete channel"
        irreversible
        errorAction="delete this channel"
        onConfirm={() =>
          Promise.reject(Object.assign(new Error("D1_ERROR"), { status: 500 }))
        }
      />
    </>
  );
}

const VARIANTS = [
  "default",
  "danger",
  "secondary",
  "outline",
  "ghost",
  "destructive",
] as const;

function ButtonsFixture() {
  return (
    <div className="flex h-full flex-col gap-6 overflow-auto p-6 text-rm-text">
      <section className="flex flex-col gap-3">
        <h2 className="text-ui-md font-semibold">Enabled</h2>
        <div className="flex flex-wrap gap-3">
          {VARIANTS.map((v) => (
            <Button key={v} variant={v}>
              {v}
            </Button>
          ))}
        </div>
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-ui-md font-semibold">Disabled</h2>
        <div className="flex flex-wrap gap-3">
          {VARIANTS.map((v) => (
            <Button key={v} variant={v} disabled>
              {v}
            </Button>
          ))}
        </div>
      </section>
      <section className="flex max-w-sm flex-col gap-3 rounded-lg border border-rm-border bg-rm-bg-surface p-4 dark:bg-rm-bg-elevated">
        <h2 className="text-ui-md font-semibold">Real labels</h2>
        <div className="flex flex-wrap gap-3">
          <Button size="lg" disabled>
            Join room
          </Button>
          <Button disabled>Create server</Button>
          <Button variant="danger" disabled>
            Delete channel
          </Button>
        </div>
      </section>
    </div>
  );
}

const COVERS = [
  coverNightdrive,
  coverPaperboats,
  coverCopperline,
  coverSlowfires,
  coverGlasshouse,
  coverSmallhours,
  coverTidelines,
];

function images(count: number, prefix: string): Attachment[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}-${i}`,
    filename: `photo-${i + 1}.webp`,
    file_key: `fixtures/${prefix}-${i}.webp`,
    url: i === 0 && count === 1 ? shareFrame : COVERS[i % COVERS.length],
    content_type: "image/webp",
    size_bytes: 120_000,
  })) as Attachment[];
}

function ImageGridFixture() {
  return (
    <div className="h-full overflow-auto p-4 md:p-6">
      <div className="flex max-w-3xl flex-col gap-6">
        {[1, 2, 3, 4, 5, 12].map((count) => (
          <section key={count} className="flex flex-col gap-2">
            <h2 className="text-ui-xs font-semibold tracking-[0.08em] text-rm-text-muted uppercase">
              {count} {count === 1 ? "image" : "images"}
              {count === 2 ? " · deletable" : ""}
            </h2>
            <ImageGrid
              attachments={images(count, `g${count}`)}
              username="grace"
              messageId={`m-grid-${count}`}
              onDelete={count === 2 ? noop : undefined}
            />
          </section>
        ))}
      </div>
    </div>
  );
}

function VideoFixture() {
  return (
    <div className="h-full overflow-auto p-4 md:p-6">
      <div className="flex max-w-xl flex-col gap-6">
        <section className="flex flex-col gap-2">
          <h2 className="text-ui-xs font-semibold tracking-[0.08em] text-rm-text-muted uppercase">
            Unplayable codec
          </h2>
          <VideoAttachment
            src="/fixtures/unplayable.mkv"
            filename="screen-recording.mkv"
            aspectRatio={16 / 9}
            showDownload
          />
        </section>
        <section className="flex flex-col gap-2">
          <h2 className="text-ui-xs font-semibold tracking-[0.08em] text-rm-text-muted uppercase">
            Poster fallback after an error
          </h2>
          <VideoAttachment
            src="/fixtures/missing.mp4"
            filename="clip.mp4"
            poster={shareFrame}
            aspectRatio={16 / 9}
            fallbackToPosterOnError
          />
        </section>
      </div>
    </div>
  );
}
