import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";

export interface RemoveEmbedsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Removes every embed on the message. The caller closes the dialog. */
  onConfirm: () => void;
}

/**
 * Confirm for clearing a message's embeds for everyone. There is no way to
 * bring them back from the UI, so the action is `danger`. Shift-click on the
 * remove button skips it; the caller owns that bypass.
 */
export function RemoveEmbedsDialog({
  open,
  onOpenChange,
  onConfirm,
}: RemoveEmbedsDialogProps) {
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="md:max-w-sm">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Are you sure?</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            This will remove all embeds on this message for everyone.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <p className="text-ui-xs text-rm-text-secondary">
          Hold shift when clearing embeds to skip this modal.
        </p>
        <ResponsiveDialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm}>
            Remove All Embeds
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
