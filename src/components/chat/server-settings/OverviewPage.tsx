/**
 * Server settings → Overview: icon, name, public sharing and the danger zone,
 * on the Studio card/row recipe (design-system 12.6). The form state lives in
 * `useOverviewForm` so the shell can put Save in the workbench footer.
 */

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { apiDelete, apiPatch, apiUpload } from "@/lib/api-client";
import { describeApiError } from "@/lib/api-errors";
import { getAuthAssetUrl } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";
import { SettingsSwitch } from "../SettingsSwitch";
import {
  ConfirmStrip,
  RowError,
  SettingsCard,
  SettingsRow,
  useConfirm,
} from "../settings/primitives";

export type ServerUpdates = {
  name?: string;
  icon_url?: string | null;
  allow_public_shares?: boolean;
  show_source_in_shares?: boolean;
  allow_share_indexing?: boolean;
};

const MAX_ICON_BYTES = 8 * 1024 * 1024;
const ICON_TYPES = "image/png,image/jpeg,image/gif,image/webp,image/avif";

export function useOverviewForm({
  serverId,
  serverName,
  iconUrl,
  allowPublicShares,
  showSourceInShares,
  allowShareIndexing,
  onUpdated,
}: {
  serverId: string;
  serverName: string;
  iconUrl: string | null;
  allowPublicShares: boolean;
  showSourceInShares: boolean;
  allowShareIndexing: boolean;
  onUpdated: (updates: ServerUpdates) => void;
}) {
  const [saved, setSaved] = useState({
    name: serverName,
    iconUrl,
    allowPublicShares,
    showSourceInShares,
    allowShareIndexing,
  });
  const [name, setName] = useState(serverName);
  const [nameError, setNameError] = useState<string | null>(null);
  const [shares, setShares] = useState({
    allowPublicShares,
    showSourceInShares,
    allowShareIndexing,
  });
  const [iconFile, setIconFile] = useState<File | null>(null);
  const [iconPreview, setIconPreview] = useState<string | null>(null);
  const [removeIcon, setRemoveIcon] = useState(false);
  const [iconError, setIconError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  useEffect(
    () => () => {
      if (iconPreview) URL.revokeObjectURL(iconPreview);
    },
    [iconPreview],
  );

  const dirty =
    name.trim() !== saved.name ||
    iconFile !== null ||
    removeIcon ||
    shares.allowPublicShares !== saved.allowPublicShares ||
    shares.showSourceInShares !== saved.showSourceInShares ||
    shares.allowShareIndexing !== saved.allowShareIndexing;

  const touch = () => {
    setJustSaved(false);
    setSaveError(null);
  };

  const pickIcon = (file: File) => {
    touch();
    if (!file.type.startsWith("image/")) {
      setIconError("Choose an image file: PNG, JPG, GIF, WebP or AVIF.");
      return;
    }
    if (file.size > MAX_ICON_BYTES) {
      setIconError("Choose an image under 8 MB.");
      return;
    }
    setIconError(null);
    setIconFile(file);
    setRemoveIcon(false);
    setIconPreview(URL.createObjectURL(file));
  };

  const clearIcon = () => {
    touch();
    setIconFile(null);
    setIconPreview(null);
    setIconError(null);
    setRemoveIcon(true);
  };

  const save = async () => {
    if (saving) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError("Enter a server name.");
      return;
    }
    setNameError(null);
    setSaving(true);
    setSaveError(null);
    try {
      let nextIcon: string | null | undefined;
      if (iconFile) {
        const formData = new FormData();
        formData.append("file", iconFile);
        try {
          const data = await apiUpload<{ url: string }>(
            "/api/servers/icon-upload",
            formData,
          );
          nextIcon = data.url;
        } catch (err) {
          setIconError(describeApiError(err, "upload the server icon"));
          return;
        }
      } else if (removeIcon) {
        nextIcon = null;
      }

      const updates: ServerUpdates = {
        allow_public_shares: shares.allowPublicShares,
        show_source_in_shares: shares.showSourceInShares,
        allow_share_indexing: shares.allowShareIndexing,
      };
      if (trimmed !== saved.name) updates.name = trimmed;
      if (nextIcon !== undefined) updates.icon_url = nextIcon;

      await apiPatch(`/api/servers/${serverId}/settings`, updates);
      onUpdated(updates);
      setSaved({
        name: trimmed,
        iconUrl: nextIcon !== undefined ? nextIcon : saved.iconUrl,
        ...shares,
      });
      setName(trimmed);
      setIconFile(null);
      setIconPreview(null);
      setRemoveIcon(false);
      setJustSaved(true);
    } catch (err) {
      setSaveError(describeApiError(err, "save the server settings"));
    } finally {
      setSaving(false);
    }
  };

  return {
    name,
    setName: (value: string) => {
      touch();
      setNameError(null);
      setName(value);
    },
    nameError,
    shares,
    setShare: (key: keyof typeof shares, value: boolean) => {
      touch();
      setShares((prev) => ({ ...prev, [key]: value }));
    },
    currentIconUrl: removeIcon ? null : saved.iconUrl,
    iconPreview,
    iconError,
    pickIcon,
    clearIcon,
    saving,
    saveError,
    justSaved,
    dirty,
    save,
  };
}

export type OverviewForm = ReturnType<typeof useOverviewForm>;

/** Sticky footer: save status on the leading side, Save on the trailing. */
export function OverviewSaveBar({ form }: { form: OverviewForm }) {
  return (
    <div className="flex flex-col gap-3">
      {form.saveError ? (
        <RowError className="mt-0">{form.saveError}</RowError>
      ) : null}
      <div className="flex items-center justify-end gap-3">
        <p
          role="status"
          className="flex min-w-0 flex-1 items-center gap-1.5 text-ui-sm"
        >
          {form.justSaved && !form.dirty ? (
            <>
              <Icon
                name="success"
                size="sm"
                className="shrink-0 text-rm-success-ink"
              />
              <span className="text-rm-success-ink">Saved</span>
            </>
          ) : form.dirty ? (
            <span className="text-rm-text-secondary">Unsaved changes</span>
          ) : null}
        </p>
        <Button
          type="button"
          className="max-md:min-h-11"
          loading={form.saving}
          disabled={!form.dirty}
          onClick={() => void form.save()}
        >
          Save changes
        </Button>
      </div>
    </div>
  );
}

function IconRow({ form }: { form: OverviewForm }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const shown =
    form.iconPreview ??
    (form.currentIconUrl ? getAuthAssetUrl(form.currentIconUrl) : null);
  return (
    <SettingsRow
      id="server-icon"
      label="Server icon"
      layout="stack"
      description="A square image at least 512 × 512. PNG, JPG, GIF, WebP or AVIF, up to 8 MB."
      leading={
        <span className="flex size-16 items-center justify-center overflow-hidden rounded-full border border-rm-border bg-rm-tint-1">
          {shown ? (
            <img src={shown} alt="" className="size-full object-cover" />
          ) : (
            <Icon name="image" size="xl" className="text-rm-text-muted" />
          )}
        </span>
      }
      footer={
        form.iconError ? <RowError>{form.iconError}</RowError> : undefined
      }
    >
      {({ labelId }) => (
        <>
          <input
            ref={fileRef}
            type="file"
            accept={ICON_TYPES}
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) form.pickIcon(file);
              event.target.value = "";
            }}
          />
          <Button
            type="button"
            variant="secondary"
            className="max-md:min-h-11"
            aria-describedby={labelId}
            onClick={() => fileRef.current?.click()}
          >
            <Icon name="image" size="sm" />
            {shown ? "Change image" : "Upload image"}
          </Button>
          {shown ? (
            <Button
              type="button"
              variant="ghost"
              className="max-md:min-h-11"
              onClick={form.clearIcon}
            >
              Remove
            </Button>
          ) : null}
        </>
      )}
    </SettingsRow>
  );
}

function NameRow({ form, canEdit }: { form: OverviewForm; canEdit: boolean }) {
  const errorId = "server-name-error";
  return (
    <SettingsRow
      id="server-name"
      label="Server name"
      layout="block"
      description={
        canEdit
          ? undefined
          : "Only people with the Manage server permission can change it."
      }
    >
      {({ labelId, descId }) => (
        <div className="flex flex-col gap-2">
          <Input
            value={form.name}
            readOnly={!canEdit}
            maxLength={100}
            aria-labelledby={labelId}
            aria-describedby={
              [descId, form.nameError ? errorId : null]
                .filter(Boolean)
                .join(" ") || undefined
            }
            aria-invalid={form.nameError ? true : undefined}
            onChange={(event) => form.setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && canEdit) void form.save();
            }}
            className={cn(
              "max-md:min-h-11 md:max-w-[360px]",
              !canEdit && "bg-rm-tint-1",
            )}
          />
          {form.nameError ? (
            <p id={errorId} className="text-ui-xs text-rm-danger-ink">
              {form.nameError}
            </p>
          ) : null}
        </div>
      )}
    </SettingsRow>
  );
}

const SHARE_ROWS = [
  {
    key: "allowPublicShares",
    label: "Allow public message shares",
    desc: "Members can share a snapshot of a message to a link anyone can open, no account needed.",
  },
  {
    key: "showSourceInShares",
    label: "Show server and channel on shares",
    desc: "Shared pages name this server and the channel the message came from.",
  },
  {
    key: "allowShareIndexing",
    label: "Let search engines index shares",
    desc: "Shared pages can appear in search results. Off keeps them reachable by link only.",
  },
] as const;

function DeleteServerCard({
  serverId,
  serverName,
  initialArmed,
  onDeleted,
}: {
  serverId: string;
  serverName: string;
  initialArmed: boolean;
  onDeleted: () => void;
}) {
  const { armed, arm, cancel, done, triggerRef } = useConfirm();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!initialArmed) return;
    arm();
    // Opened armed (a deep link or fixture): bring the strip into view.
    const frame = requestAnimationFrame(() => {
      inputRef.current?.scrollIntoView?.({ block: "center" });
      inputRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [initialArmed, arm]);

  const open = () => {
    setTyped("");
    setError(null);
    arm();
    // ConfirmStrip focuses Cancel on mount; the name field is the next step.
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const confirm = async () => {
    if (typed.trim() !== serverName) {
      setError(`Type ${serverName} exactly to delete it.`);
      inputRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiDelete(`/api/servers/${serverId}/settings`);
      done();
      onDeleted();
    } catch (err) {
      setError(describeApiError(err, "delete this server"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsCard
      title="Delete server"
      description={`Deletes ${serverName} for everyone, with all of its channels, messages, roles and invites. This can't be undone.`}
    >
      <SettingsRow
        id="delete-server"
        label="Delete this server"
        layout="inline"
        hideLabel
        footer={
          armed ? (
            <ConfirmStrip
              irreversible
              busy={busy}
              error={error}
              confirmLabel="Delete server"
              onCancel={() => {
                setError(null);
                cancel();
              }}
              onConfirm={() => void confirm()}
              consequence={
                <>
                  <strong className="font-semibold">
                    Delete {serverName}?
                  </strong>{" "}
                  Every member loses access and its messages are gone for good.
                  Type the server name to confirm.
                  <input
                    ref={inputRef}
                    value={typed}
                    aria-label={`Type ${serverName} to confirm`}
                    placeholder={serverName}
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(event) => {
                      setTyped(event.target.value);
                      setError(null);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void confirm();
                    }}
                    className="mt-2 block h-9 w-full rounded-md border border-rm-field-edge bg-rm-bg-surface px-3 text-ui-md text-rm-text outline-none placeholder:text-rm-text-muted max-md:min-h-11 md:max-w-[360px] md:text-ui-sm"
                  />
                </>
              }
            />
          ) : undefined
        }
      >
        {() =>
          armed ? null : (
            <Button
              ref={triggerRef}
              type="button"
              variant="destructive"
              className="max-md:min-h-11"
              onClick={open}
            >
              <Icon name="trash" size="sm" />
              Delete server
            </Button>
          )
        }
      </SettingsRow>
    </SettingsCard>
  );
}

export function OverviewPage({
  form,
  serverId,
  serverName,
  canEdit,
  isOwner,
  initialConfirmDelete,
  onDeleted,
}: {
  form: OverviewForm;
  serverId: string;
  serverName: string;
  canEdit: boolean;
  isOwner: boolean;
  initialConfirmDelete: boolean;
  onDeleted: () => void;
}) {
  return (
    <>
      <SettingsCard
        title="Server profile"
        description="How this server shows in the server list and on invites."
      >
        {canEdit ? <IconRow form={form} /> : null}
        <NameRow form={form} canEdit={canEdit} />
      </SettingsCard>

      {canEdit ? (
        <SettingsCard
          title="Public sharing"
          description="Controls whether messages here can be shared to public links."
        >
          {SHARE_ROWS.map((row) => {
            const dependent = row.key !== "allowPublicShares";
            const disabled = dependent && !form.shares.allowPublicShares;
            return (
              <SettingsRow
                key={row.key}
                id={`share-${row.key}`}
                label={row.label}
                description={row.desc}
                layout="inline"
                disabled={disabled}
              >
                {({ labelId, descId }) => (
                  <SettingsSwitch
                    checked={form.shares[row.key]}
                    disabled={disabled}
                    labelledBy={labelId}
                    describedBy={descId}
                    onChange={() =>
                      form.setShare(row.key, !form.shares[row.key])
                    }
                  />
                )}
              </SettingsRow>
            );
          })}
        </SettingsCard>
      ) : null}

      {isOwner ? (
        <DeleteServerCard
          serverId={serverId}
          serverName={serverName}
          initialArmed={initialConfirmDelete}
          onDeleted={onDeleted}
        />
      ) : null}
    </>
  );
}
