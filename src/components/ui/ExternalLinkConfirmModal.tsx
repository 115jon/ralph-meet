import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";

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
    <ResponsiveDialog
      open={open}
      onOpenChange={(nextOpen) => !nextOpen && onClose()}
    >
      <ResponsiveDialogContent className="md:max-w-sm">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Leaving Ralph Meet</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            This link is taking you to the following website
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <div className="max-h-24 overflow-auto overscroll-contain rounded-lg border border-rm-border bg-rm-tint-1 px-4 py-3 text-ui-sm text-rm-text-secondary [overflow-wrap:anywhere]">
          {pending.url}
        </div>

        <label className="flex cursor-pointer items-center gap-3 text-ui-sm text-rm-text-secondary pointer-coarse:min-h-11">
          <input
            type="checkbox"
            checked={trustDomain}
            onChange={(event) => onTrustDomainChange(event.target.checked)}
            className="size-5 shrink-0 rounded-sm border-rm-border bg-rm-bg-surface accent-primary"
          />
          <span className="min-w-0 [overflow-wrap:anywhere]">
            Trust {pending.hostname} links from now on
          </span>
        </label>

        <ResponsiveDialogFooter>
          <Button type="button" variant="secondary" onClick={onClose}>
            Go Back
          </Button>
          <Button type="button" onClick={onConfirm}>
            Visit Site
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
