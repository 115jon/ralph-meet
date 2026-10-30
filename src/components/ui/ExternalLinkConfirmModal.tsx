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
      <ResponsiveDialogContent size="sm">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Leaving Ralph Meet</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            This link opens the website below in your browser.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <div className="max-h-24 overflow-auto overscroll-contain rounded-md border border-line bg-ply-2 px-3 py-2 text-ui-sm text-ink-1 [overflow-wrap:anywhere]">
          {pending.url}
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-ui-sm text-ink-2 pointer-coarse:min-h-11">
          <input
            type="checkbox"
            checked={trustDomain}
            onChange={(event) => onTrustDomainChange(event.target.checked)}
            className="size-4 shrink-0 rounded-xs border-line-field bg-ply-2 accent-(--accent-ink)"
          />
          <span className="min-w-0 [overflow-wrap:anywhere]">
            Trust {pending.hostname} links from now on
          </span>
        </label>

        <ResponsiveDialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Go back
          </Button>
          <Button type="button" onClick={onConfirm}>
            Visit site
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
