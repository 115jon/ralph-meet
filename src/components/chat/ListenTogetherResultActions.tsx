import { ActionSheet } from "@/components/ui/action-sheet";
import { Icon } from "@/components/ui/icon";
import { IconButton } from "@/components/ui/IconButton";
import type {
  ListenTogetherResultAction,
  ListenTogetherResultActionId,
} from "./ListenTogetherResultActionModel";

export function ListenTogetherResultActionTrigger({
  label,
  onClick,
}: {
  label: string;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <IconButton
      icon="more"
      size={28}
      variant="muted"
      aria-label={`More actions for ${label}`}
      aria-haspopup="menu"
      onClick={onClick}
    />
  );
}

/**
 * The phone form of a search result's actions. Same item model as the
 * desktop context menu; the shared ActionSheet owns the scrim, focus,
 * Escape/back handling and safe-area padding.
 */
export function ListenTogetherMobileActionSheet({
  title,
  actions,
  open = true,
  onAction,
  onClose,
}: {
  title: string;
  actions: ListenTogetherResultAction[];
  open?: boolean;
  onAction: (action: ListenTogetherResultActionId) => void;
  onClose: () => void;
}) {
  return (
    <ActionSheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={title}
      showTitle
      items={actions.map((action) => ({
        key: action.id,
        label: action.label,
        icon: <Icon name={action.icon} size="md" />,
        onClick: () => onAction(action.id),
      }))}
    />
  );
}
