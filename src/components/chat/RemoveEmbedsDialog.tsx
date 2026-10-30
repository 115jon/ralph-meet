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
      <ResponsiveDialogContent size="sm">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Remove embeds?</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            This removes the previews from this message for everyone.
            Shift-click the × to skip this.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ResponsiveDialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm}>
            Remove
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
