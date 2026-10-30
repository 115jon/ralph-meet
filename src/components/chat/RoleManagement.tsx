/**
 * Server settings → Roles.
 *
 *   split  list (256) beside the editor, inside the workbench page
 *   push   the list is the page; choosing a role pushes the editor, and the
 *          workbench header's back button (and Escape) pops it. Used on
 *          phones and wherever the page is too narrow for two columns.
 *
 * The shell owns `editorOpen` so its header back button and Escape ladder
 * can close the editor. Save and Reset live in the workbench's shared
 * UnsavedBar: the editor reports its draft through `onUnsavedChange`, and
 * while it is dirty the shell refuses to switch role or page (`blocked`),
 * nudging the bar instead (overlays audit issue 7, flow 3).
 */

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { HIT, PRESS } from "@/components/ui/interaction";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api-client";
import { describeApiError } from "@/lib/api-errors";
import { PERMISSIONS } from "@/lib/permissions";
import type { Role } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import InlineEmojiText from "./InlineEmojiText";
import { SettingsSwitch } from "./SettingsSwitch";
import type { UnsavedBarProps } from "./settings/UnsavedBar";
import {
  ConfirmStrip,
  SettingsCard,
  SettingsRow,
  useConfirm,
} from "./settings/primitives";
import { FieldRow } from "./server-settings/Field";
import { LoadError, SkeletonRows } from "./server-settings/states";

/** What the role editor hands the workbench's save bar. */
export type RoleUnsaved = Pick<
  UnsavedBarProps,
  "dirty" | "saving" | "error" | "onReset" | "onSave" | "saveLabel"
>;

interface RoleManagementProps {
  serverId: string;
  /** Role to open first (fixtures, deep links). */
  initialRoleId?: string;
  /** Two columns; otherwise list and editor push. */
  split: boolean;
  /** Push layout only: the editor is showing instead of the list. */
  editorOpen: boolean;
  onEditorOpenChange: (open: boolean) => void;
  /** Push layout: the page title for the open editor. */
  onEditorTitle?: (title: string | null) => void;
  /** The open editor's draft state for the save bar (null when none). */
  onUnsavedChange?: (state: RoleUnsaved | null) => void;
  /** The draft is dirty: switching role calls `onBlocked` instead. */
  blocked?: boolean;
  onBlocked?: () => void;
}

/** Token fallback for a role with no colour of its own. */
const NO_COLOR = "var(--ink-3)";
/** <input type="color"> only accepts #rrggbb, so it needs a hex start. */
const PICKER_START = "#99aab5"; // ds-allow:raw-color native colour input needs a hex value
const HEX = /^#[0-9a-f]{6}$/i;

type PermissionDef = { mask: number; name: string; desc: string };

const PERMISSION_GROUPS: { title: string; items: PermissionDef[] }[] = [
  {
    title: "Server",
    items: [
      {
        mask: PERMISSIONS.ADMINISTRATOR,
        name: "Administrator",
        desc: "Every permission, and channel overrides don't apply. Give this sparingly.",
      },
      {
        mask: PERMISSIONS.MANAGE_SERVER,
        name: "Manage server",
        desc: "Change the server name, icon, sharing and invites.",
      },
      {
        mask: PERMISSIONS.MANAGE_ROLES,
        name: "Manage roles",
        desc: "Create, edit and delete roles below their own.",
      },
      {
        mask: PERMISSIONS.MANAGE_CATEGORIES,
        name: "Manage categories",
        desc: "Create, rename and reorder categories.",
      },
      {
        mask: PERMISSIONS.MANAGE_CHANNELS,
        name: "Manage channels",
        desc: "Create, edit and delete channels.",
      },
    ],
  },
  {
    title: "Members",
    items: [
      {
        mask: PERMISSIONS.KICK_MEMBERS,
        name: "Kick members",
        desc: "Remove members. They can rejoin with an invite.",
      },
      {
        mask: PERMISSIONS.BAN_MEMBERS,
        name: "Ban members",
        desc: "Remove members and stop them rejoining.",
      },
      {
        mask: PERMISSIONS.CREATE_INVITE,
        name: "Create invites",
        desc: "Make invite links for this server.",
      },
    ],
  },
  {
    title: "Messages",
    items: [
      {
        mask: PERMISSIONS.SEND_MESSAGES,
        name: "Send messages",
        desc: "Post in text channels.",
      },
      {
        mask: PERMISSIONS.MANAGE_MESSAGES,
        name: "Manage messages",
        desc: "Delete and pin other people's messages.",
      },
    ],
  },
];

type Draft = { name: string; color: string; permissions: number };

const has = (permissions: number, mask: number) =>
  (permissions & mask) === mask;

function Swatch({ color }: { color: string | null | undefined }) {
  return (
    <span
      aria-hidden="true"
      className="size-3 shrink-0 rounded-full"
      // A role's colour is the person's own data (7.1 exception).
      style={{ backgroundColor: color || NO_COLOR }}
    />
  );
}

function RoleList({
  roles,
  selectedId,
  creating,
  narrow,
  onSelect,
  onCreate,
}: {
  roles: Role[];
  selectedId: string | null;
  creating: boolean;
  narrow: boolean;
  onSelect: (role: Role) => void;
  onCreate: () => void;
}) {
  return (
    <section aria-label="Roles" className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-ui-sm text-ink-2">
          {roles.length === 1 ? "1 role" : `${roles.length} roles`}
        </p>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="max-md:min-h-11"
          onClick={onCreate}
        >
          <Icon name="add" size="sm" />
          New role
        </Button>
      </div>
      <ul
        className={cn(
          "flex flex-col",
          narrow
            ? "divide-y divide-line rounded-lg border border-line bg-ply-2"
            : "gap-px",
        )}
      >
        {roles.map((role) => {
          const current = !narrow && !creating && role.id === selectedId;
          return (
            <li key={role.id}>
              <button
                type="button"
                aria-current={current ? "true" : undefined}
                onClick={() => onSelect(role)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-sm text-left transition-colors duration-(--dur-1) ease-out",
                  PRESS,
                  HIT,
                  narrow ? "min-h-12 px-4 text-ui-row" : "h-8 px-2 text-ui-sm",
                  current
                    ? "bg-tint-2 font-semibold text-ink-1"
                    : "font-medium text-ink-2 pointer-fine:hover:bg-tint-1 pointer-fine:hover:text-ink-1",
                  narrow && "rounded-none text-ink-1",
                )}
              >
                <Swatch color={role.color} />
                <InlineEmojiText
                  text={role.name}
                  className="min-w-0 flex-1 truncate"
                />
                {role.is_default ? (
                  <span className="text-ui-xs font-medium text-ink-3">
                    Everyone
                  </span>
                ) : null}
                {narrow ? (
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
        {creating && !narrow ? (
          <li>
            <span className="flex h-8 items-center gap-2.5 rounded-sm bg-tint-2 px-2 text-ui-sm font-semibold text-ink-1">
              <Swatch color={null} />
              New role
            </span>
          </li>
        ) : null}
      </ul>
    </section>
  );
}

const draftOf = (role: Role | null): Draft => ({
  name: role?.name ?? "New role",
  color: role?.color ?? "",
  permissions: role?.permissions ?? 0,
});

function RoleEditor({
  serverId,
  role,
  creating,
  titled,
  onSaved,
  onDeleted,
  onCancelCreate,
  onUnsavedChange,
}: {
  serverId: string;
  role: Role | null;
  creating: boolean;
  /** Show the role name; off when the page header already names it. */
  titled: boolean;
  onSaved: (savedId: string | null) => Promise<void>;
  onDeleted: (roleId: string) => Promise<void>;
  /** Reset on a new-role draft drops the draft. */
  onCancelCreate: () => void;
  onUnsavedChange?: (state: RoleUnsaved | null) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(role));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [colorError, setColorError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const { armed, arm, cancel, done, triggerRef } = useConfirm();
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const nameId = useId();
  const nameHelpId = useId();
  const colorId = useId();
  const colorHelpId = useId();

  const isDefault = Boolean(role?.is_default);
  const isAdmin = has(draft.permissions, PERMISSIONS.ADMINISTRATOR);
  const roleName = creating ? "New role" : (role?.name ?? "");
  const dirty =
    creating ||
    draft.name !== (role?.name ?? "") ||
    draft.color !== (role?.color ?? "") ||
    draft.permissions !== (role?.permissions ?? 0);

  const edit = (patch: Partial<Draft>) => {
    setJustSaved(false);
    setSaveError(null);
    setDraft((prev) => ({ ...prev, ...patch }));
  };

  const reset = () => {
    if (creating) {
      onCancelCreate();
      return;
    }
    setDraft(draftOf(role));
    setSaveError(null);
    setNameError(null);
    setColorError(null);
  };

  const save = async () => {
    if (saving) return;
    const name = draft.name.trim();
    const color = draft.color.trim();
    const badName = !name;
    const badColor = Boolean(color) && !HEX.test(color);
    setNameError(badName ? "Enter a role name." : null);
    setColorError(
      badColor ? "Enter a colour as # and six hex digits, like #3e9b4f." : null,
    );
    if (badName || badColor) {
      document.getElementById(badName ? nameId : colorId)?.focus();
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const body = {
        name,
        color: color || null,
        permissions: draft.permissions,
      };
      if (creating) {
        const created = await apiPost<{ id?: string } | null>(
          `/api/servers/${serverId}/roles`,
          body,
        );
        await onSaved(created?.id ?? null);
      } else if (role) {
        await apiPatch(`/api/servers/${serverId}/roles/${role.id}`, body);
        await onSaved(role.id);
      }
      setJustSaved(true);
    } catch (err) {
      setSaveError(
        describeApiError(err, creating ? "create this role" : "save this role"),
      );
    } finally {
      setSaving(false);
    }
  };

  /* Report the draft to the workbench save bar. The handlers go through a
     ref so the report only changes when the visible state does. */
  const handlers = useRef({ save, reset });
  useEffect(() => {
    handlers.current = { save, reset };
  });
  useEffect(() => {
    onUnsavedChange?.({
      dirty,
      saving,
      error: saveError,
      saveLabel: creating ? "Create role" : "Save changes",
      onSave: () => void handlers.current.save(),
      onReset: () => handlers.current.reset(),
    });
  }, [creating, dirty, onUnsavedChange, saveError, saving]);
  useEffect(() => () => onUnsavedChange?.(null), [onUnsavedChange]);

  const confirmDelete = async () => {
    if (!role) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await apiDelete(`/api/servers/${serverId}/roles/${role.id}`);
      done();
      await onDeleted(role.id);
    } catch (err) {
      setDeleteError(describeApiError(err, `delete ${role.name}`));
    } finally {
      setDeleting(false);
    }
  };

  const canDelete = !isDefault && !creating;

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4">
      {titled || (canDelete && !armed) ? (
        <div className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-2">
          {titled ? (
            <h3 className="flex min-w-0 flex-1 items-center gap-2 text-ui-lg font-semibold text-ink-1">
              <Swatch color={draft.color || role?.color} />
              <InlineEmojiText text={roleName} className="truncate" />
            </h3>
          ) : (
            <span className="flex-1" />
          )}
          {canDelete && !armed ? (
            <Button
              ref={triggerRef}
              type="button"
              variant="destructive"
              className="max-md:min-h-11"
              onClick={() => {
                setDeleteError(null);
                arm();
              }}
            >
              <Icon name="trash" size="sm" />
              Delete
            </Button>
          ) : null}
        </div>
      ) : null}
      <p role="status" className="sr-only">
        {justSaved && !dirty ? "Role saved" : ""}
      </p>
      {armed && role ? (
        <ConfirmStrip
          irreversible
          busy={deleting}
          error={deleteError}
          confirmLabel="Delete role"
          consequence={
            <>
              <strong className="font-semibold">
                Delete <InlineEmojiText text={role.name} />?
              </strong>{" "}
              Everyone with this role loses its permissions. This can't be
              undone.
            </>
          }
          onCancel={() => {
            setDeleteError(null);
            cancel();
          }}
          onConfirm={() => void confirmDelete()}
        />
      ) : null}

      {isDefault ? (
        <p className="text-pretty text-ui-sm text-ink-2">
          Everyone has this role. Its name and colour are fixed.
        </p>
      ) : (
        <SettingsCard title="Display">
          <FieldRow
            label="Role name"
            htmlFor={nameId}
            helperId={nameHelpId}
            error={nameError}
          >
            <Input
              id={nameId}
              value={draft.name}
              maxLength={100}
              aria-invalid={nameError ? true : undefined}
              aria-describedby={nameError ? nameHelpId : undefined}
              onChange={(event) => {
                setNameError(null);
                edit({ name: event.target.value });
              }}
              className="max-md:min-h-11"
            />
          </FieldRow>
          <FieldRow
            label="Colour"
            htmlFor={colorId}
            helperId={colorHelpId}
            helper="Names with this role show in this colour. Leave empty for none."
            error={colorError}
          >
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={HEX.test(draft.color) ? draft.color : PICKER_START}
                aria-label="Pick a role colour"
                onChange={(event) => {
                  setColorError(null);
                  edit({ color: event.target.value });
                }}
                className="size-8 shrink-0 cursor-pointer rounded-md border border-line-field bg-transparent p-0.5 max-md:size-11"
              />
              <Input
                id={colorId}
                value={draft.color}
                placeholder="#3e9b4f"
                spellCheck={false}
                aria-invalid={colorError ? true : undefined}
                aria-describedby={colorHelpId}
                onChange={(event) => {
                  setColorError(null);
                  edit({ color: event.target.value });
                }}
                className="max-w-40 font-mono max-md:min-h-11"
              />
              {draft.color ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="max-md:min-h-11"
                  onClick={() => edit({ color: "" })}
                >
                  Clear
                </Button>
              ) : null}
            </div>
          </FieldRow>
        </SettingsCard>
      )}

      {PERMISSION_GROUPS.map((group, index) => (
        <SettingsCard
          key={group.title}
          title={group.title}
          description={
            index === 0 && isAdmin
              ? "Administrator is on, so this role has every permission."
              : undefined
          }
        >
          {group.items.map((perm) => {
            const locked = isAdmin && perm.mask !== PERMISSIONS.ADMINISTRATOR;
            const checked = locked || has(draft.permissions, perm.mask);
            return (
              <SettingsRow
                key={perm.mask}
                id={`perm-${perm.mask}`}
                label={perm.name}
                description={perm.desc}
                layout="inline"
                disabled={locked}
              >
                {({ labelId, descId }) => (
                  <SettingsSwitch
                    checked={checked}
                    disabled={locked}
                    labelledBy={labelId}
                    describedBy={descId}
                    onChange={() =>
                      edit({ permissions: draft.permissions ^ perm.mask })
                    }
                  />
                )}
              </SettingsRow>
            );
          })}
        </SettingsCard>
      ))}
    </div>
  );
}

export default function RoleManagement({
  serverId,
  initialRoleId,
  split,
  editorOpen,
  onEditorOpenChange,
  onEditorTitle,
  onUnsavedChange,
  blocked = false,
  onBlocked,
}: RoleManagementProps) {
  const [roles, setRoles] = useState<Role[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialRoleId ?? null,
  );
  const [creatingDraft, setCreating] = useState(false);
  // A new-role draft only lives while its editor is showing.
  const creating = creatingDraft && (split || editorOpen);

  const fetchRoles = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await apiGet<Role[]>(`/api/servers/${serverId}/roles`);
      setRoles(data);
      setSelectedId(
        (prev) =>
          (prev && data.some((r) => r.id === prev) ? prev : null) ??
          (data.find((r) => r.is_default) ?? data[0])?.id ??
          null,
      );
      return data;
    } catch (err) {
      setLoadError(describeApiError(err, "load the roles"));
      return null;
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  useEffect(() => {
    void fetchRoles();
  }, [fetchRoles]);

  const selected = roles?.find((r) => r.id === selectedId) ?? null;
  const showEditor = split || editorOpen;

  const editorTitle = creating ? "New role" : (selected?.name ?? null);
  useEffect(() => {
    onEditorTitle?.(!split && editorOpen ? editorTitle : null);
  }, [editorOpen, editorTitle, onEditorTitle, split]);

  const select = (role: Role) => {
    if (blocked && (creating || role.id !== selectedId)) {
      onBlocked?.();
      return;
    }
    setCreating(false);
    setSelectedId(role.id);
    if (!split) onEditorOpenChange(true);
  };

  const startCreate = () => {
    if (blocked) {
      onBlocked?.();
      return;
    }
    setCreating(true);
    if (!split) onEditorOpenChange(true);
  };

  if (loadError && !roles) {
    return (
      <LoadError
        title="Roles didn't load"
        message={loadError}
        retrying={loading}
        onRetry={() => void fetchRoles()}
      />
    );
  }
  if (!roles)
    return (
      <SkeletonRows
        label="Loading roles"
        rows={4}
        avatar={false}
        rowClass="h-12"
      />
    );

  const editor =
    selected || creating ? (
      <RoleEditor
        key={creating ? "new" : selected?.id}
        serverId={serverId}
        role={creating ? null : selected}
        creating={creating}
        titled={split}
        onUnsavedChange={onUnsavedChange}
        onCancelCreate={() => {
          setCreating(false);
          if (!split) onEditorOpenChange(false);
        }}
        onSaved={async (savedId) => {
          const data = await fetchRoles();
          if (creating) {
            setCreating(false);
            const created =
              (savedId && data?.find((r) => r.id === savedId)) ??
              data?.[data.length - 1];
            if (created) setSelectedId(created.id);
          }
        }}
        onDeleted={async (roleId) => {
          setSelectedId((prev) => (prev === roleId ? null : prev));
          if (!split) onEditorOpenChange(false);
          await fetchRoles();
        }}
      />
    ) : null;

  if (!split) {
    return showEditor && editor ? (
      <div className="mx-auto w-full max-w-[720px]">{editor}</div>
    ) : (
      <div className="mx-auto w-full max-w-[720px]">
        <RoleList
          roles={roles}
          selectedId={selectedId}
          creating={creating}
          narrow
          onSelect={select}
          onCreate={startCreate}
        />
      </div>
    );
  }

  return (
    <div className="flex items-start gap-6">
      <div className="sticky top-0 w-64 shrink-0">
        <RoleList
          roles={roles}
          selectedId={selectedId}
          creating={creating}
          narrow={false}
          onSelect={select}
          onCreate={startCreate}
        />
      </div>
      {editor ?? (
        <p className="flex-1 py-12 text-center text-ui-sm text-ink-2">
          Choose a role to edit it.
        </p>
      )}
    </div>
  );
}
