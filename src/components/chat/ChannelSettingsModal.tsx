/**
 * Channel settings on the shared settings workbench (design-audit ST-09,
 * ST-20, ST-42): Overview (name, topic, public sharing) and Permissions
 * (per role and member overrides).
 *
 * Both pages keep edits as drafts behind a sticky save bar. Closing with
 * unsaved edits doesn't drop them: the save bar asks to save or reset first.
 */

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useIsMobile, WIDE_QUERY } from "@/hooks/useMediaQuery";
import { apiPatch } from "@/lib/api-client";
import { describeApiError } from "@/lib/api-errors";
import { useClientDateFormatter } from "@/lib/client-date-format";
import type { Channel } from "@/lib/types";
import { cn } from "@/lib/utils";
import { sanitizeChannelName } from "@/lib/validations";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import ChannelPermissionsTab, {
  PermissionsSaveBar,
  SaveBar,
  SavedText,
  UnsavedText,
} from "./ChannelPermissionsTab";
import { usePermissionOverrides } from "./channel-settings/permission-model";
import InlineEmojiText from "./InlineEmojiText";
import {
  RowError,
  SettingsCard,
  SettingsRow,
  SettingsSelect,
} from "./settings/primitives";
import { SettingsWorkbench, WorkbenchNav } from "./settings/SettingsWorkbench";
import { useWorkbenchNav } from "./settings/useWorkbenchNav";

type ChannelSettingsTab = "overview" | "permissions";

type ChannelUpdates = {
  name?: string;
  description?: string | null;
  allow_public_shares?: boolean | null;
};

interface ChannelSettingsModalProps {
  open: boolean;
  serverId: string;
  channel: Channel;
  userPermissions?: number | null;
  onClose: () => void;
  onUpdated?: (updates: ChannelUpdates) => void;
  /** Page to open on (and push into on phones). Defaults to Overview. */
  initialTab?: ChannelSettingsTab;
  /** Role or member id whose override opens in the editor. */
  initialOverrideId?: string;
}

const DESCRIPTION_MAX = 1024;

/* lg+: the permissions list sits beside the editor. */
function subscribeWide(listener: () => void) {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const query = window.matchMedia(WIDE_QUERY);
  query.addEventListener?.("change", listener);
  return () => query.removeEventListener?.("change", listener);
}
function useIsWide() {
  return useSyncExternalStore(
    subscribeWide,
    () =>
      typeof window !== "undefined" && window.matchMedia
        ? window.matchMedia(WIDE_QUERY).matches
        : false,
    () => true,
  );
}

const NAV_GROUPS = [
  {
    items: [
      { id: "overview", label: "Overview", icon: "settings" as const },
      { id: "permissions", label: "Permissions", icon: "shield" as const },
    ],
  },
];

export default function ChannelSettingsModal({
  open,
  serverId,
  channel,
  onClose,
  onUpdated,
  initialTab,
  initialOverrideId,
}: ChannelSettingsModalProps) {
  const narrow = useIsMobile();
  const wide = useIsWide();
  const nav = useWorkbenchNav<ChannelSettingsTab>(initialTab ?? "overview");
  const { reset: resetNav } = nav;
  const [selectedId, setSelectedId] = useState<string | null>(
    initialOverrideId ?? null,
  );
  const [closeBlocked, setCloseBlocked] = useState(false);

  // Opening on a given page pushes straight into it on phones.
  useLayoutEffect(() => {
    if (!open) return;
    resetNav(initialTab ?? "overview", !initialTab);
    setSelectedId(initialOverrideId ?? null);
    setCloseBlocked(false);
  }, [open, initialTab, initialOverrideId, resetNav]);

  const isVoice = channel.channel_type === "voice";
  const channelLabel = isVoice ? channel.name : `#${channel.name}`;

  /* ---------------- Overview form ---------------- */
  const [name, setName] = useState(channel.name);
  const [description, setDescription] = useState(channel.description ?? "");
  const [shareOverride, setShareOverride] = useState<boolean | null>(
    channel.allow_public_shares ?? null,
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const formatDate = useClientDateFormatter();

  const resetOverview = () => {
    setName(channel.name);
    setDescription(channel.description ?? "");
    setShareOverride(channel.allow_public_shares ?? null);
    setSaveError(null);
    setNameError(null);
  };

  useEffect(() => {
    setName(channel.name);
    setDescription(channel.description ?? "");
    setShareOverride(channel.allow_public_shares ?? null);
    setSaveError(null);
    setNameError(null);
  }, [
    channel.id,
    channel.name,
    channel.description,
    channel.allow_public_shares,
  ]);

  const previewName = isVoice ? name : sanitizeChannelName(name, "text", false);
  const finalName = isVoice
    ? name.trim()
    : sanitizeChannelName(name, "text", true);

  const overviewDirty =
    finalName !== channel.name ||
    (description || null) !== (channel.description || null) ||
    shareOverride !== (channel.allow_public_shares ?? null);

  const edited = () => {
    setSaved(false);
    setSaveError(null);
    setCloseBlocked(false);
  };

  const handleSave = async () => {
    if (!overviewDirty || saving) return;
    if (!finalName) {
      setNameError("Enter a channel name.");
      document.getElementById(nameFieldId)?.focus();
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const updates: ChannelUpdates = {};
      if (finalName !== channel.name) updates.name = finalName;
      if ((description || null) !== (channel.description || null)) {
        updates.description = description || null;
      }
      if (shareOverride !== (channel.allow_public_shares ?? null)) {
        updates.allow_public_shares = shareOverride;
      }
      const updated = await apiPatch<Channel>(
        `/api/channels/${channel.id}`,
        updates,
      );
      setSaved(true);
      setCloseBlocked(false);
      onUpdated?.({
        name: updated.name,
        description: updated.description,
        allow_public_shares: updated.allow_public_shares,
      });
    } catch (err) {
      setSaveError(describeApiError(err, "save the channel"));
    } finally {
      setSaving(false);
    }
  };

  /* ---------------- Permissions ---------------- */
  const [permissionsSeen, setPermissionsSeen] = useState(
    initialTab === "permissions",
  );
  if (open && nav.active === "permissions" && !permissionsSeen) {
    setPermissionsSeen(true);
  }
  const permissions = usePermissionOverrides({
    serverId,
    channelId: channel.id,
    enabled: open && permissionsSeen,
  });
  const permissionsDirty = permissions.dirtyIds.length > 0;

  /* ---------------- Close guard ---------------- */
  const handleClose = () => {
    if (overviewDirty || permissionsDirty) {
      setCloseBlocked(true);
      if (nav.active === "overview" && !overviewDirty) nav.go("permissions");
      if (nav.active === "permissions" && !permissionsDirty) nav.go("overview");
      if (narrow && nav.showList) nav.setShowList(false);
      return;
    }
    onClose();
  };

  const nameFieldId = useId();
  const descFieldId = useId();
  const nameHelpId = useId();

  /* ---------------- Page selection ---------------- */
  const onPermissions = nav.active === "permissions";
  const stacked = !wide;
  const selected =
    onPermissions && permissions.status === "ready"
      ? (permissions.overrides.find((o) => o.target_id === selectedId) ?? null)
      : null;
  const editorPushed = onPermissions && stacked && Boolean(selected);

  const pageTitle =
    editorPushed && selected ? (
      <InlineEmojiText text={selected.name} />
    ) : onPermissions ? (
      "Permissions"
    ) : (
      "Overview"
    );

  const footer: ReactNode = onPermissions ? (
    permissions.status === "ready" &&
    (permissionsDirty || permissions.saveError || permissions.justSaved) ? (
      <PermissionsSaveBar model={permissions} closeBlocked={closeBlocked} />
    ) : null
  ) : (
    <SaveBar
      status={
        saveError ? (
          <RowError className="mt-0">{saveError}</RowError>
        ) : overviewDirty ? (
          <UnsavedText blocked={closeBlocked} />
        ) : saved ? (
          <SavedText />
        ) : null
      }
      onReset={overviewDirty ? resetOverview : undefined}
      onSave={() => void handleSave()}
      saving={saving}
      canSave={overviewDirty}
    />
  );

  const createdOn = formatDate(channel.created_at, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <SettingsWorkbench
      open={open}
      onClose={handleClose}
      title="Channel settings"
      subtitle={<InlineEmojiText text={channelLabel} />}
      activeId={nav.active}
      showList={nav.showList}
      onShowListChange={nav.setShowList}
      nav={
        <WorkbenchNav
          groups={NAV_GROUPS}
          activeId={nav.active}
          onSelect={(id) => nav.go(id as ChannelSettingsTab)}
        />
      }
      pageTitle={pageTitle}
      pageKey={`${nav.active}-${editorPushed ? selectedId : "list"}`}
      back={
        editorPushed
          ? {
              label: "Back to permissions",
              onBack: () => setSelectedId(null),
            }
          : undefined
      }
      width={onPermissions && !stacked ? "full" : "prose"}
      footer={footer}
    >
      {onPermissions ? (
        <ChannelPermissionsTab
          model={permissions}
          isVoice={isVoice}
          channelLabel={channelLabel}
          selectedId={selectedId}
          onSelect={(id) => {
            setSelectedId(id);
            setCloseBlocked(false);
          }}
          split={!stacked}
        />
      ) : (
        <SettingsCard
          title="Channel details"
          description={`${isVoice ? "Voice" : "Text"} channel, created ${createdOn}.`}
        >
          <FieldRow>
            <Label htmlFor={nameFieldId}>Channel name</Label>
            <Input
              id={nameFieldId}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setNameError(null);
                edited();
              }}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={nameError ? true : undefined}
              aria-describedby={nameHelpId}
              className="max-md:min-h-11"
            />
            <p
              id={nameHelpId}
              className={cn(
                "text-ui-xs",
                nameError ? "text-rm-danger-ink" : "text-rm-text-secondary",
              )}
            >
              {nameError ??
                (!isVoice && previewName !== name ? (
                  <>
                    Shown as{" "}
                    <span className="font-medium text-rm-text">
                      #<InlineEmojiText text={previewName || "channel"} />
                    </span>
                  </>
                ) : isVoice ? (
                  "Shown in the channel list as typed."
                ) : (
                  "Lowercase, with dashes instead of spaces."
                ))}
            </p>
          </FieldRow>
          <FieldRow>
            <Label htmlFor={descFieldId}>Topic</Label>
            <textarea
              id={descFieldId}
              value={description}
              onChange={(e) => {
                setDescription(e.target.value.slice(0, DESCRIPTION_MAX));
                edited();
              }}
              rows={3}
              placeholder="What this channel is for"
              className="min-h-11 w-full min-w-0 resize-y rounded-md border border-rm-field-edge bg-transparent px-3 py-2 text-ui-md text-rm-text outline-none placeholder:text-rm-text-muted md:text-ui-sm"
            />
            <p className="text-right text-ui-xs tabular-nums text-rm-text-secondary">
              {description.length} / {DESCRIPTION_MAX}
            </p>
          </FieldRow>
          <SettingsRow
            id="channel-public-shares"
            label="Public sharing"
            description="Whether people can share messages from this channel with a public link."
            layout="stack"
          >
            {(ids) => (
              <SettingsSelect
                ids={ids}
                value={
                  shareOverride === null
                    ? "inherit"
                    : shareOverride
                      ? "allow"
                      : "deny"
                }
                options={[
                  { value: "inherit", label: "Use the server setting" },
                  { value: "allow", label: "Allow public links" },
                  { value: "deny", label: "Turn off public links" },
                ]}
                onValueChange={(value) => {
                  setShareOverride(
                    value === "inherit" ? null : value === "allow",
                  );
                  edited();
                }}
              />
            )}
          </SettingsRow>
        </SettingsCard>
      )}
    </SettingsWorkbench>
  );
}

function FieldRow({ children }: { children: ReactNode }) {
  return (
    <li className="flex flex-col gap-2 px-4 py-3.5 @min-[560px]:px-5">
      {children}
    </li>
  );
}
