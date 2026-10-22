import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { IconButton } from "@/components/ui/IconButton";
import { X } from "lucide-react";

export interface PendingExternalLink {
  url: string;
  hostname: string;
}

export function ExternalLinkConfirmModal({
  open,
  pending,
  trustDomain,
  onTrustDomainChange,
  onClose,
  onConfirm,
}: {
  open: boolean;
  pending: PendingExternalLink;
  trustDomain: boolean;
  onTrustDomainChange: (value: boolean) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="w-full max-w-[510px] p-6 text-rm-text-primary"
      >
        <section>
          <DialogClose asChild>
            <IconButton
              icon={X}
              type="button"
              aria-label="Close external link confirmation"
              className="absolute right-4 top-4"
            />
          </DialogClose>

          <DialogTitle className="pr-8 text-ui-lg font-semibold">
            Leaving Ralph Meet
          </DialogTitle>
          <DialogDescription className="mt-1 text-sm text-rm-text-muted">
            This link is taking you to the following website
          </DialogDescription>

          <div className="mt-5 max-h-24 overflow-auto rounded-lg border border-rm-border bg-rm-tint-1 px-4 py-3 text-sm leading-5 text-rm-text-secondary [overflow-wrap:anywhere]">
            {pending.url}
          </div>

          <label className="mt-3 flex cursor-pointer items-center gap-3 text-sm text-rm-text-secondary">
            <input
              type="checkbox"
              checked={trustDomain}
              onChange={(event) => onTrustDomainChange(event.target.checked)}
              className="h-5 w-5 rounded border-rm-border bg-rm-bg-surface accent-primary"
            />
            <span>Trust {pending.hostname} links from now on</span>
          </label>

          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" onClick={onClose}>
              Go Back
            </Button>
            <Button type="button" onClick={onConfirm}>
              Visit Site
            </Button>
          </div>
        </section>
      </DialogContent>
    </Dialog>
  );
}
