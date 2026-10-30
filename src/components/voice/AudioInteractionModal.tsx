import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";

interface AudioInteractionModalProps {
  open: boolean;
  onInteract: () => void;
  onClose: () => void;
}

export function AudioInteractionModal({
  open,
  onInteract,
  onClose,
}: AudioInteractionModalProps) {
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(nextOpen) => !nextOpen && onClose()}
    >
      <ResponsiveDialogContent className="md:max-w-sm">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Turn on sound</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Your browser needs one click before it can play the call.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <ResponsiveDialogFooter>
          <Button
            type="button"
            size="lg"
            autoFocus
            className="w-full"
            onClick={onInteract}
          >
            Turn on sound
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
