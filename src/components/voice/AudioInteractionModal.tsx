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
          <ResponsiveDialogTitle>Interaction required</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Browsers require user interaction before they will play audio. Just
            click okay to continue.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <ResponsiveDialogFooter>
          <Button
            type="button"
            size="lg"
            className="w-full"
            onClick={onInteract}
          >
            Okay
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
