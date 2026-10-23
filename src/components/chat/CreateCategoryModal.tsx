import { Button } from "@/components/ui/button";
import { DialogPortal, DialogSurface } from "@/components/ui/dialog";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { IconButton } from "@/components/ui/IconButton";
import { Input } from "@/components/ui/input";
import { useChatActions } from "@/stores/chat-store";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/icon";
import { cn as _cn } from "@/lib/utils";

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
  const [_error, _setError] = useState<string | null>(null);

  const isMobile = useIsMobile();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Close on Escape

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
    <div className="space-y-3">
      <label
        htmlFor="category-name"
        className="text-ui-2xs font-semibold uppercase tracking-[0.08em] text-rm-text-muted"
      >
        Category Name
      </label>
      <Input
        id="category-name"
        ref={inputRef}
        value={name}
        onChange={(e) => setName(e.target.value.toUpperCase())}
        onKeyDown={(e) => e.key === "Enter" && handleCreate()}
        placeholder="NEW CATEGORY"
        className="h-10 uppercase"
      />
    </div>
  );

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(nextOpen) => !nextOpen && onClose()}
    >
      {isMobile ? (
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="flex items-center gap-2">
              <Icon name="tag" size="xl" className="text-rm-text/40" />
              Create Category
            </ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              Categories help you organize your channels and keep things tidy.
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          {fields}
          <ResponsiveDialogFooter>
            <Button
              onClick={handleCreate}
              disabled={!name.trim() || creating}
              loading={creating}
            >
              Create Category
            </Button>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      ) : (
        <DialogPortal>
          <div
            data-state={open ? "open" : "closed"}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 transition-opacity duration-200 data-[state=closed]:pointer-events-none data-[state=closed]:opacity-0"
          >
            {/* Backdrop */}
            <button
              type="button"
              data-base-modal-backdrop
              className="absolute inset-0 border-0 bg-black/60 p-0 animate-in fade-in duration-300"
              onClick={onClose}
              aria-label="Close create category modal"
            />

            {/* Modal */}
            <DialogSurface
              showCloseButton={false}
              className="relative z-10 w-full max-w-md animate-in fade-in zoom-in-95 rounded-xl border border-rm-border bg-rm-bg-surface dark:bg-rm-bg-elevated p-6 shadow-[var(--rm-shadow-3)] duration-200 data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=closed]:zoom-out-95"
            >
              {/* Close */}
              <IconButton
                icon="close"
                onClick={onClose}
                className="absolute right-4 top-4"
                aria-label="Close create category modal"
              />

              <h2 className="mb-1 text-center text-ui-lg font-semibold text-rm-text flex items-center justify-center gap-2">
                <Icon name="tag" size="xl" className="text-rm-text/40" />
                Create Category
              </h2>
              <p className="mb-6 text-center text-ui-sm font-medium text-rm-text-muted">
                Categories help you organize your channels and keep things tidy.
              </p>

              {fields}

              <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button variant="secondary" onClick={onClose}>
                  Cancel
                </Button>
                <Button
                  onClick={handleCreate}
                  disabled={!name.trim() || creating}
                  loading={creating}
                >
                  Create Category
                </Button>
              </div>
            </DialogSurface>
          </div>
        </DialogPortal>
      )}
    </ResponsiveDialog>
  );
}
