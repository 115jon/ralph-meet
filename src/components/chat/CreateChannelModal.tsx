import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Icon, type IconName } from "@/components/ui/icon";
import { describeApiError } from "@/lib/api-errors";
import { cn } from "@/lib/utils";
import { sanitizeChannelName } from "@/lib/channel-name";
import { useChatActions, useChatStore } from "@/stores/chat-store";
import { useCallback, useId, useRef, useState } from "react";

interface Props {
  open: boolean;
  serverId: string;
  defaultCategoryId?: string | null;
  onClose: () => void;
}

type ChannelType = "text" | "voice";

const TYPE_CHOICES: Array<{
  value: ChannelType;
  label: string;
  description: string;
  icon: IconName;
}> = [
  {
    value: "text",
    label: "Text",
    description: "Send messages, images, GIFs, and more.",
    icon: "textChannel",
  },
  {
    value: "voice",
    label: "Voice",
    description: "Hang out with voice, video, and screen share.",
    icon: "voiceChannel",
  },
];

/**
 * A text choice card (the settings ChoiceCard recipe): 16 radio, 14/500
 * label, 13 ink-2 description, padding 12, radius 8. Selected takes the
 * accent ring and accent tint, and the radio fills.
 */
function ChoiceCard({
  name,
  checked,
  onSelect,
  icon,
  label,
  description,
}: {
  name: string;
  checked: boolean;
  onSelect: () => void;
  icon: IconName;
  label: string;
  description: string;
}) {
  return (
    <label
      className={cn(
        "relative flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors duration-(--dur-1) ease-out",
        "has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus",
        checked
          ? "border-transparent bg-accent-tint ring-2 ring-accent-ink ring-inset"
          : "border-line pointer-fine:hover:bg-tint-1",
      )}
    >
      <input
        type="radio"
        name={name}
        className="sr-only"
        checked={checked}
        onChange={onSelect}
      />
      <span
        aria-hidden="true"
        className={cn(
          "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
          checked ? "border-accent-ink bg-accent-ink" : "border-line-strong",
        )}
      >
        {checked ? <span className="size-1.5 rounded-full bg-ply-0" /> : null}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="flex items-center gap-1.5 text-ui-row font-medium text-ink-1">
          <Icon
            name={icon}
            size="sm"
            className={checked ? "text-accent-ink" : "text-ink-3"}
          />
          {label}
        </span>
        <span className="text-ui-sm text-pretty text-ink-2">{description}</span>
      </span>
    </label>
  );
}

export default function CreateChannelModal({
  open,
  serverId,
  defaultCategoryId,
  onClose,
}: Props) {
  const { createChannel, dispatch } = useChatActions();
  const categoryName = useChatStore((state) =>
    defaultCategoryId
      ? state.categories.find((category) => category.id === defaultCategoryId)
          ?.name
      : undefined,
  );
  const [name, setName] = useState("");
  const [type, setType] = useState<ChannelType>("text");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const ids = useId();
  const helperId = `${ids}-helper`;
  const errorId = `${ids}-error`;

  // Create stays enabled; an empty name is caught here, inline.
  const handleCreate = useCallback(async () => {
    if (creating) return;

    const finalName = sanitizeChannelName(name, type, true);
    if (!finalName) {
      setError("Give the channel a name.");
      inputRef.current?.focus();
      return;
    }

    setCreating(true);
    setCreateError(null);
    // createChannel adds the channel optimistically and resolves with the
    // real one; navigate only once the real id is known.
    const channel = await createChannel(
      serverId,
      finalName,
      type,
      defaultCategoryId || undefined,
    );
    if (channel) {
      if (type === "text") {
        dispatch({ type: "SET_ACTIVE_CHANNEL", channelId: channel.id });
      }
      onClose();
    } else {
      setCreateError(describeApiError(null, "create the channel"));
    }
    setCreating(false);
  }, [
    name,
    creating,
    createChannel,
    serverId,
    type,
    defaultCategoryId,
    dispatch,
    onClose,
  ]);

  const fields = (
    <div className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-ui-sm font-medium text-ink-1">
          Channel type
        </legend>
        {TYPE_CHOICES.map((choice) => (
          <ChoiceCard
            key={choice.value}
            name="channel-type"
            checked={type === choice.value}
            onSelect={() => setType(choice.value)}
            icon={choice.icon}
            label={choice.label}
            description={choice.description}
          />
        ))}
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="channel-name">Channel name</Label>
        <div className="relative">
          <Icon
            name={type === "text" ? "textChannel" : "voiceChannel"}
            size="sm"
            className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-ink-3"
          />
          <Input
            id="channel-name"
            ref={inputRef}
            value={name}
            onChange={(e) => {
              setName(sanitizeChannelName(e.target.value, type));
              setError(null);
            }}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            placeholder={type === "text" ? "new-channel" : "General Voice"}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${errorId} ${helperId}` : helperId}
            className="ps-8 max-md:min-h-11"
          />
        </div>
        {error ? (
          <p id={errorId} className="text-ui-xs text-danger-ink">
            {error}
          </p>
        ) : null}
        <p id={helperId} className="text-ui-sm text-ink-3">
          {categoryName ? `In ${categoryName}` : "Not in a category"}
        </p>
      </div>

      {createError ? (
        <p role="alert" className="text-ui-xs text-danger-ink">
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
          <ResponsiveDialogTitle>Create channel</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        {fields}
        <ResponsiveDialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleCreate} loading={creating}>
            Create channel
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
