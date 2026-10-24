import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useChatActions } from "@/stores/chat-store";
import { useCallback, useRef, useState } from "react";
import { Icon } from "@/components/ui/icon";

interface Props {
  open: boolean;
  serverId: string;
  onClose: () => void;
}

export default function CreateCategoryModal({
  open,
  serverId,
  onClose,
}: Props) {
  const { createCategory } = useChatActions();
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleCreate = useCallback(async () => {
    if (!name.trim() || creating) return;
    setCreating(true);
    const category = await createCategory(serverId, name.trim().toUpperCase());
    if (category) {
      onClose();
    }
    setCreating(false);
  }, [name, creating, createCategory, serverId, onClose]);

  const fields = (
    <div className="flex flex-col gap-2">
      <Label htmlFor="category-name">Category name</Label>
      <Input
        id="category-name"
        ref={inputRef}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && handleCreate()}
        placeholder="New category"
        className="max-md:min-h-11"
      />
    </div>
  );

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(nextOpen) => !nextOpen && onClose()}
    >
      <ResponsiveDialogContent
        className="md:max-w-md"
        // Desktop only: the drawer keeps focus on its surface so the phone
        // keyboard does not jump up on open.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="flex items-center gap-2">
            <Icon name="tag" size="xl" className="text-rm-text-muted" />
            Create category
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Categories help you organize your channels and keep things tidy.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        {fields}
        <ResponsiveDialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            disabled={!name.trim() || creating}
            loading={creating}
          >
            Create category
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
