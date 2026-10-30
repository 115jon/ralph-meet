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
import { EmptyState } from "@/components/ui/empty-state";
import { describeApiError } from "@/lib/api-errors";
import { Icon } from "@/components/ui/icon";
import { PRESS } from "@/components/ui/interaction";
import { getAuthAssetUrl } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { useRef, useState, type ReactNode } from "react";
import { AvatarImage } from "./AvatarImage";
import { avatarShape } from "@/components/ui/avatar-shape";
import InlineEmojiText from "./InlineEmojiText";
import { LoadError, SkeletonRows } from "./server-settings/states";
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
        !color && "bg-ink-3",
        className,
      )}
      style={color ? { backgroundColor: color } : undefined}
    />
  );
}

/** Keeps the person's avatar framing (AvatarImage reads `display`). */
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
      className={cn(
        "flex size-6 shrink-0 items-center justify-center bg-tint-3 font-display text-[11px] font-extrabold text-ink-1",
        avatarShape(avatarUrl && display),
      )}
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
  "flex w-full items-center gap-2.5 rounded-sm px-2 text-left outline-offset-[-2px] transition-colors duration-(--dur-1) ease-out min-h-12 md:min-h-10";

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
                        "text-ui-md text-ink-1 md:text-ui-sm pointer-fine:hover:bg-tint-1",
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
                          "text-ui-md text-ink-1 md:text-ui-sm pointer-fine:hover:bg-tint-1",
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
              <p className="px-2 py-3 text-ui-sm text-ink-2">
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
                        ? "bg-tint-2 font-semibold text-ink-1"
                        : "font-medium text-ink-1 pointer-fine:hover:bg-tint-1",
                      "text-ui-md md:text-ui-sm",
                    )}
                  >
                    <OverrideMark override={o} />
                    <span className="min-w-0 flex-1">
                      <InlineEmojiText
                        text={o.name}
                        className="block truncate"
                      />
                      <span className="block text-ui-xs font-normal text-ink-3">
                        {o.target_type === "role" ? "Role" : "Member"}
                        {dirty ? " · Unsaved" : ""}
                      </span>
                    </span>
                    {!split ? (
                      <Icon
                        name="chevronRight"
                        size="xs"
                        className="shrink-0 text-ink-3"
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
      <h5 className="px-2 pb-1 text-ui-xs font-medium text-ink-3">{title}</h5>
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
      setRemoveError(describeApiError(err, "remove this override"));
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
        <li className="px-4 pb-3">
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

function EmptyEditor({ channelLabel }: { channelLabel: string }) {
  return (
    <EmptyState
      size="sm"
      title="Pick a role or member"
      description={
        <>
          Choose one from the list to change what they can do in{" "}
          <InlineEmojiText text={channelLabel} />, or add a new override.
        </>
      }
      className="justify-start pt-7"
    />
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
      <LoadError
        title="Permissions didn't load"
        message={model.loadError ?? "Unable to load the permissions."}
        onRetry={() => void model.reload()}
      />
    );
  }

  if (model.status !== "ready") {
    return (
      <SkeletonRows
        label="Loading permissions"
        rows={3}
        avatar={false}
        rowClass="h-10"
      />
    );
  }

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
