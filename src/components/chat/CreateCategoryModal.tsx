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
import { describeApiError } from "@/lib/api-errors";
import { useChatActions } from "@/stores/chat-store";
import { useCallback, useId, useRef, useState } from "react";

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
  const [error, setError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const errorId = `${useId()}-error`;

  // Create stays enabled; an empty name is caught here, inline.
  const handleCreate = useCallback(async () => {
    if (creating) return;
    if (!name.trim()) {
      setError("Give the category a name.");
      inputRef.current?.focus();
      return;
    }
    setCreating(true);
    setCreateError(null);
    const category = await createCategory(serverId, name.trim().toUpperCase());
    if (category) {
      onClose();
    } else {
      setCreateError(describeApiError(null, "create the category"));
    }
    setCreating(false);
  }, [name, creating, createCategory, serverId, onClose]);

  const fields = (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="category-name">Category name</Label>
      <Input
        id="category-name"
        ref={inputRef}
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          setError(null);
        }}
        onKeyDown={(e) => e.key === "Enter" && handleCreate()}
        placeholder="New category"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className="max-md:min-h-11"
      />
      {error ? (
        <p id={errorId} className="text-ui-xs text-danger-ink">
          {error}
        </p>
      ) : null}
      {createError ? (
        <p role="alert" className="mt-2 text-ui-xs text-danger-ink">
          {createError}
        </p>
      ) : null}
    </div>
  );

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(nextOpen) => !nextOpen && onClose()}
    >
      <ResponsiveDialogContent
        size="md"
        placement="top"
        // Desktop only: the drawer keeps focus on its surface so the phone
        // keyboard does not jump up on open.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Create category</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Categories help you organize your channels and keep things tidy.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        {fields}
        <ResponsiveDialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleCreate} loading={creating}>
            Create category
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
