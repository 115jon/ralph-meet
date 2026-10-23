/**
 * Channel permission overrides (design-audit ST-03, ST-16, ST-17, ST-42).
 *
 *   split (lg+)   the overrides list beside the editor for the selected one
 *   stacked       the list, then the editor as a pushed page; the settings
 *                 workbench draws the back button (ChannelSettingsModal)
 *
 * Data and drafts live in `usePermissionOverrides`, owned by the modal so its
 * footer can save and its header can title the pushed page.
 */

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { PRESS } from "@/components/ui/interaction";
import { getAuthAssetUrl } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { useRef, useState, type ReactNode } from "react";
import { AvatarImage } from "./AvatarImage";
import InlineEmojiText from "./InlineEmojiText";
import {
  TEXT_PERMISSIONS,
  VOICE_PERMISSIONS,
  triStateOf,
  type PermissionModel,
  type PermissionOverride,
} from "./channel-settings/permission-model";
import { PermissionTriState } from "./channel-settings/PermissionTriState";
import {
  ConfirmStrip,
  RowError,
  SettingsCard,
  SettingsRow,
  useConfirm,
} from "./settings/primitives";

interface ChannelPermissionsTabProps {
  model: PermissionModel;
  isVoice: boolean;
  /** "#general" or the voice channel's name, for copy. */
  channelLabel: string;
  selectedId: string | null;
  onSelect: (targetId: string | null) => void;
  /** List and editor side by side. */
  split: boolean;
}

/* ------------------------------------------------------------------ */
/* Identity marks                                                       */
/* ------------------------------------------------------------------ */

/** Role colour dot. The colour is the role's own (data); none = muted ink. */
function RoleDot({
  color,
  className,
}: {
  color?: string | null;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "size-3 shrink-0 rounded-full",
        !color && "bg-rm-text-muted",
        className,
      )}
      style={color ? { backgroundColor: color } : undefined}
    />
  );
}

function MemberAvatar({
  name,
  avatarUrl,
  display,
}: {
  name: string;
  avatarUrl?: string | null;
  display?: PermissionOverride["avatar_display"];
}) {
  return (
    <span
      aria-hidden="true"
      className="flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-rm-tint-2 text-ui-2xs font-semibold text-rm-text"
    >
      {avatarUrl ? (
        <AvatarImage
          src={getAuthAssetUrl(avatarUrl)}
          alt=""
          display={display}
        />
      ) : (
        (name[0] ?? "?").toUpperCase()
      )}
    </span>
  );
}

function OverrideMark({ override }: { override: PermissionOverride }) {
  return override.target_type === "role" ? (
    <span className="flex size-6 shrink-0 items-center justify-center">
      <RoleDot color={override.color} />
    </span>
  ) : (
    <MemberAvatar
      name={override.name}
      avatarUrl={override.avatar_url}
      display={override.avatar_display}
    />
  );
}

/* ------------------------------------------------------------------ */
/* List                                                                 */
/* ------------------------------------------------------------------ */

const ROW =
  "flex w-full items-center gap-3 rounded-md px-2 text-left outline-offset-[-2px] transition-colors duration-150 ease-(--rm-ease-out) min-h-12 md:min-h-10";

function OverrideList({
  model,
  selectedId,
  onSelect,
  split,
  channelLabel,
}: {
  model: PermissionModel;
  selectedId: string | null;
  onSelect: (targetId: string) => void;
  split: boolean;
  channelLabel: string;
}) {
  const [adding, setAdding] = useState(false);
  const addRef = useRef<HTMLButtonElement>(null);
  const { availableRoles, availableMembers } = model;

  const closePicker = () => {
    setAdding(false);
    requestAnimationFrame(() => addRef.current?.focus());
  };

  return (
    <SettingsCard
      title={
        adding ? "Add an override" : split ? "Overrides" : "Roles and members"
      }
      description={
        adding
          ? `Pick a role or member to change what they can do in ${channelLabel}.`
          : undefined
      }
      actions={
        <Button
          ref={addRef}
          type="button"
          variant={adding ? "ghost" : "secondary"}
          size="sm"
          aria-expanded={adding}
          onClick={() => (adding ? closePicker() : setAdding(true))}
        >
          {adding ? null : <Icon name="add" size="sm" />}
          {adding ? "Cancel" : "Add"}
        </Button>
      }
    >
      <li className="px-2 pb-2 pt-2">
        {adding ? (
          <div className="flex flex-col gap-3">
            {availableRoles.length > 0 ? (
              <PickerGroup title="Roles">
                {availableRoles.map((role) => (
                  <li key={role.id}>
                    <button
                      type="button"
                      onClick={() => {
                        model.addOverride({ id: role.id, type: "role" });
                        setAdding(false);
                        onSelect(role.id);
                      }}
                      className={cn(
                        ROW,
                        PRESS,
                        "text-ui-md text-rm-text md:text-ui-sm pointer-fine:hover:bg-rm-tint-1",
                      )}
                    >
                      <span className="flex size-6 shrink-0 items-center justify-center">
                        <RoleDot color={role.color} />
                      </span>
                      <InlineEmojiText
                        text={role.name}
                        className="min-w-0 flex-1 truncate"
                      />
                    </button>
                  </li>
                ))}
              </PickerGroup>
            ) : null}
            {availableMembers.length > 0 ? (
              <PickerGroup title="Members">
                {availableMembers.map((member) => {
                  const name =
                    member.user.display_name?.trim() || member.user.username;
                  return (
                    <li key={member.user.id}>
                      <button
                        type="button"
                        onClick={() => {
                          model.addOverride({
                            id: member.user.id,
                            type: "user",
                          });
                          setAdding(false);
                          onSelect(member.user.id);
                        }}
                        className={cn(
                          ROW,
                          PRESS,
                          "text-ui-md text-rm-text md:text-ui-sm pointer-fine:hover:bg-rm-tint-1",
                        )}
                      >
                        <MemberAvatar
                          name={name}
                          avatarUrl={member.user.avatar_url}
                          display={member.user.avatar_display}
                        />
                        <InlineEmojiText
                          text={name}
                          className="min-w-0 flex-1 truncate"
                        />
                      </button>
                    </li>
                  );
                })}
              </PickerGroup>
            ) : null}
            {availableRoles.length === 0 && availableMembers.length === 0 ? (
              <p className="px-2 py-3 text-ui-sm text-rm-text-secondary">
                Every role and member already has an override here.
              </p>
            ) : null}
          </div>
        ) : (
          <ul className="flex flex-col gap-px">
            {model.overrides.map((o) => {
              const current = selectedId === o.target_id;
              const dirty = model.isDirty(o);
              return (
                <li key={o.target_id}>
                  <button
                    type="button"
                    aria-current={current && split ? "true" : undefined}
                    onClick={() => onSelect(o.target_id)}
                    className={cn(
                      ROW,
                      PRESS,
                      current && split
                        ? "bg-rm-tint-2 font-semibold text-rm-text"
                        : "font-medium text-rm-text pointer-fine:hover:bg-rm-tint-1",
                      "text-ui-md md:text-ui-sm",
                    )}
                  >
                    <OverrideMark override={o} />
                    <span className="min-w-0 flex-1">
                      <InlineEmojiText
                        text={o.name}
                        className="block truncate"
                      />
                      <span className="block text-ui-xs font-normal text-rm-text-secondary">
                        {o.target_type === "role" ? "Role" : "Member"}
                        {dirty ? " · Unsaved" : ""}
                      </span>
                    </span>
                    {!split ? (
                      <Icon
                        name="chevronRight"
                        size="xs"
                        className="shrink-0 text-rm-text-muted"
                      />
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </li>
    </SettingsCard>
  );
}

function PickerGroup({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div>
      <h5 className="px-2 pb-1 text-ui-xs font-semibold text-rm-text-secondary">
        {title}
      </h5>
      <ul className="flex flex-col gap-px">{children}</ul>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Editor                                                               */
/* ------------------------------------------------------------------ */

function OverrideEditor({
  model,
  override,
  isVoice,
  channelLabel,
  onRemoved,
}: {
  model: PermissionModel;
  override: PermissionOverride;
  isVoice: boolean;
  channelLabel: string;
  onRemoved: () => void;
}) {
  const { armed, arm, cancel, done, triggerRef } = useConfirm();
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const permissions = isVoice ? VOICE_PERMISSIONS : TEXT_PERMISSIONS;
  const isRole = override.target_type === "role";

  const remove = async () => {
    setRemoving(true);
    setRemoveError(null);
    try {
      await model.removeOverride(override.target_id);
      done();
      onRemoved();
    } catch (err) {
      setRemoveError(
        err instanceof Error ? err.message : "Unable to remove this override.",
      );
    } finally {
      setRemoving(false);
    }
  };

  return (
    <SettingsCard
      title={
        <span className="flex min-w-0 items-center gap-2">
          <OverrideMark override={override} />
          <InlineEmojiText text={override.name} className="min-w-0 truncate" />
        </span>
      }
      description={
        isRole
          ? `Inherit keeps what ${override.name} gets from its server role settings. Deny and Allow replace it in ${channelLabel}.`
          : `Inherit keeps what ${override.name} gets from their roles. Deny and Allow replace it in ${channelLabel}.`
      }
      actions={
        override.isDefault ? null : (
          <Button
            ref={triggerRef}
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setRemoveError(null);
              arm();
            }}
            disabled={armed}
          >
            <Icon name="trash" size="sm" />
            Remove
          </Button>
        )
      }
    >
      {armed ? (
        <li className="px-4 pb-3.5 @min-[560px]:px-5">
          <ConfirmStrip
            consequence={`${override.name} goes back to ${
              isRole ? "its server role" : "their role"
            } permissions in ${channelLabel}.`}
            confirmLabel="Remove override"
            onConfirm={remove}
            onCancel={cancel}
            busy={removing}
            error={removeError}
          />
        </li>
      ) : null}
      {permissions.map((perm) => (
        <SettingsRow
          key={perm.mask}
          id={`perm-${override.target_id}-${perm.mask}`}
          label={perm.name}
          description={perm.desc}
          layout="stack"
        >
          {({ labelId, descId }) => (
            <PermissionTriState
              name={`perm-${override.target_id}-${perm.mask}`}
              labelId={labelId}
              descId={descId}
              value={triStateOf(override, perm.mask)}
              disabled={model.saving}
              onChange={(value) =>
                model.setPermission(override.target_id, perm.mask, value)
              }
            />
          )}
        </SettingsRow>
      ))}
    </SettingsCard>
  );
}

/* ------------------------------------------------------------------ */
/* States                                                               */
/* ------------------------------------------------------------------ */

function ListSkeleton() {
  return (
    <div
      role="status"
      className="flex flex-col gap-2 rounded-lg border border-rm-border bg-rm-bg-surface p-3"
    >
      <span className="sr-only">Loading</span>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-10 animate-pulse rounded-md bg-rm-tint-1 motion-reduce:animate-none"
        />
      ))}
    </div>
  );
}

function EmptyEditor({ channelLabel }: { channelLabel: string }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <Icon name="shield" size="3xl" className="text-rm-text-muted" />
      <h3 className="text-ui-md font-semibold text-rm-text">
        Pick a role or member
      </h3>
      <p className="max-w-[36ch] text-pretty text-ui-sm text-rm-text-secondary">
        Choose one from the list to change what they can do in {channelLabel},
        or add a new override.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                 */
/* ------------------------------------------------------------------ */

export default function ChannelPermissionsTab({
  model,
  isVoice,
  channelLabel,
  selectedId,
  onSelect,
  split,
}: ChannelPermissionsTabProps) {
  if (model.status === "error") {
    return (
      <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
        <Icon name="warning" size="3xl" className="text-rm-text-muted" />
        <h3 className="text-ui-md font-semibold text-rm-danger-ink">
          Permissions didn't load
        </h3>
        <p className="max-w-[36ch] text-pretty text-ui-sm text-rm-text-secondary">
          {model.loadError}
        </p>
        <Button
          type="button"
          variant="secondary"
          onClick={() => void model.reload()}
        >
          Try again
        </Button>
      </div>
    );
  }

  if (model.status !== "ready") return <ListSkeleton />;

  const selected =
    model.overrides.find((o) => o.target_id === selectedId) ?? null;

  const list = (
    <OverrideList
      model={model}
      selectedId={selected?.target_id ?? null}
      onSelect={onSelect}
      split={split}
      channelLabel={channelLabel}
    />
  );
  const editor = selected ? (
    <OverrideEditor
      key={selected.target_id}
      model={model}
      override={selected}
      isVoice={isVoice}
      channelLabel={channelLabel}
      onRemoved={() => onSelect(null)}
    />
  ) : null;

  if (!split) return editor ?? list;

  return (
    <div className="grid grid-cols-[240px_minmax(0,1fr)] items-start gap-4">
      <div className="sticky top-0">{list}</div>
      <div className="min-w-0">
        {editor ?? <EmptyEditor channelLabel={channelLabel} />}
      </div>
    </div>
  );
}

/** Footer status + actions for the permissions page. */
export function PermissionsSaveBar({
  model,
  closeBlocked,
}: {
  model: PermissionModel;
  closeBlocked: boolean;
}) {
  const dirty = model.dirtyIds.length;
  return (
    <SaveBar
      status={
        model.saveError ? (
          <RowError className="mt-0">{model.saveError}</RowError>
        ) : dirty > 0 ? (
          <UnsavedText blocked={closeBlocked} />
        ) : model.justSaved ? (
          <SavedText />
        ) : null
      }
      onReset={dirty > 0 ? model.reset : undefined}
      onSave={() => void model.save()}
      saving={model.saving}
      canSave={dirty > 0}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Shared save bar (also used by the overview)                          */
/* ------------------------------------------------------------------ */

export function SavedText() {
  return (
    <span className="flex items-center gap-1.5 text-ui-sm font-medium text-rm-success-ink">
      <Icon name="success" size="sm" />
      Saved
    </span>
  );
}

export function UnsavedText({ blocked }: { blocked: boolean }) {
  return (
    <span
      className={cn(
        "text-ui-sm",
        blocked ? "font-medium text-rm-danger-ink" : "text-rm-text-secondary",
      )}
    >
      {blocked
        ? "Save or reset your changes before closing."
        : "You have unsaved changes."}
    </span>
  );
}

export function SaveBar({
  status,
  onReset,
  onSave,
  saving,
  canSave,
}: {
  status: ReactNode;
  onReset?: () => void;
  onSave: () => void;
  saving: boolean;
  canSave: boolean;
}) {
  return (
    <div className="flex flex-col gap-3 @min-[560px]:flex-row @min-[560px]:items-center">
      {/* Always mounted so the status is announced when it changes. */}
      <div role="status" className="min-w-0 flex-1">
        {status}
      </div>
      <div className="flex shrink-0 justify-end gap-2">
        {onReset ? (
          <Button
            type="button"
            variant="ghost"
            onClick={onReset}
            disabled={saving}
            className="max-md:h-11"
          >
            Reset
          </Button>
        ) : null}
        <Button
          type="button"
          onClick={onSave}
          loading={saving}
          disabled={!canSave && !saving}
          className="max-md:h-11"
        >
          Save changes
        </Button>
      </div>
    </div>
  );
}
