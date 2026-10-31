/**
 * Data model for the channel permission overrides page: loads the overrides,
 * roles and members, keeps edits as drafts until Save, and tracks which
 * overrides differ from what the server has.
 */

import { apiDelete, apiGet, apiPut } from "@/lib/api-client";
import { describeApiError } from "@/lib/api-errors";
import { PERMISSIONS } from "@/lib/permissions";
import type { Role, User } from "@/lib/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type TriState = "deny" | "inherit" | "allow";

export type PermissionOverride = {
  target_id: string;
  target_type: "role" | "user";
  allow: number;
  deny: number;
  name: string;
  /** User-chosen role colour (data, not a design token). */
  color?: string | null;
  avatar_url?: string | null;
  avatar_display?: User["avatar_display"];
  /** The server's default role (@everyone): can't be removed. */
  isDefault?: boolean;
};

export type MemberOption = {
  user: Pick<User, "id" | "username"> &
    Partial<Pick<User, "display_name" | "avatar_url" | "avatar_display">>;
};

export type PermissionDef = { mask: number; name: string; desc: string };

export const TEXT_PERMISSIONS: PermissionDef[] = [
  {
    mask: PERMISSIONS.VIEW_CHANNELS,
    name: "View channel",
    desc: "See this channel and read its messages.",
  },
  {
    mask: PERMISSIONS.MANAGE_CHANNELS,
    name: "Manage channel",
    desc: "Rename this channel, change its settings or delete it.",
  },
  {
    mask: PERMISSIONS.MANAGE_MESSAGES,
    name: "Manage messages",
    desc: "Delete other people's messages and pin any message.",
  },
  {
    mask: PERMISSIONS.SEND_MESSAGES,
    name: "Send messages",
    desc: "Post messages in this channel.",
  },
  {
    mask: PERMISSIONS.ADD_REACTIONS,
    name: "Add reactions",
    desc: "Add new emoji reactions to messages.",
  },
  {
    mask: PERMISSIONS.ATTACH_FILES,
    name: "Attach files",
    desc: "Upload files and images.",
  },
];

export const VOICE_PERMISSIONS: PermissionDef[] = [
  {
    mask: PERMISSIONS.VIEW_CHANNELS,
    name: "View channel",
    desc: "See this voice channel in the list.",
  },
  {
    mask: PERMISSIONS.MANAGE_CHANNELS,
    name: "Manage channel",
    desc: "Rename this channel, change its settings or delete it.",
  },
  {
    mask: PERMISSIONS.CONNECT,
    name: "Connect",
    desc: "Join this voice channel.",
  },
  { mask: PERMISSIONS.SPEAK, name: "Speak", desc: "Talk in this channel." },
  {
    mask: PERMISSIONS.VIDEO,
    name: "Video",
    desc: "Turn on a camera or share a screen.",
  },
  {
    mask: PERMISSIONS.MUTE_MEMBERS,
    name: "Mute members",
    desc: "Mute other people in this channel.",
  },
];

export function triStateOf(
  override: PermissionOverride,
  mask: number,
): TriState {
  if ((override.allow & mask) === mask) return "allow";
  if ((override.deny & mask) === mask) return "deny";
  return "inherit";
}

function applyTriState(
  override: PermissionOverride,
  mask: number,
  value: TriState,
): PermissionOverride {
  const allow = override.allow & ~mask;
  const deny = override.deny & ~mask;
  if (value === "allow") return { ...override, allow: allow | mask, deny };
  if (value === "deny") return { ...override, allow, deny: deny | mask };
  return { ...override, allow, deny };
}

type RawOverride = {
  target_id: string;
  target_type: "role" | "user";
  allow: number;
  deny: number;
};

type Bits = { allow: number; deny: number };

function memberName(member: MemberOption | undefined) {
  return member?.user.display_name?.trim() || member?.user.username || "";
}

export type PermissionModel = ReturnType<typeof usePermissionOverrides>;

export function usePermissionOverrides({
  serverId,
  channelId,
  enabled,
}: {
  serverId: string;
  channelId: string;
  /** Fetch only once the page is shown. */
  enabled: boolean;
}) {
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<PermissionOverride[]>([]);
  /** What the server has, by target. Missing = not created yet. */
  const [saved, setSaved] = useState<Record<string, Bits>>({});
  const [roles, setRoles] = useState<Role[]>([]);
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    const request = ++requestRef.current;
    setStatus("loading");
    setLoadError(null);
    try {
      const [rawOverrides, roleList, memberList] = await Promise.all([
        apiGet<RawOverride[]>(`/api/channels/${channelId}/permissions`),
        apiGet<Role[]>(`/api/servers/${serverId}/roles`),
        apiGet<MemberOption[]>(`/api/servers/${serverId}/members`),
      ]);
      if (request !== requestRef.current) return;
      const next: PermissionOverride[] = rawOverrides.map((o) => {
        if (o.target_type === "role") {
          const role = roleList.find((r) => r.id === o.target_id);
          return {
            target_id: o.target_id,
            target_type: "role",
            allow: o.allow,
            deny: o.deny,
            name: role?.name || "Unknown role",
            color: role?.color,
            isDefault: Boolean(role?.is_default),
          };
        }
        const member = memberList.find((m) => m.user.id === o.target_id);
        return {
          target_id: o.target_id,
          target_type: "user",
          allow: o.allow,
          deny: o.deny,
          name: memberName(member) || "Unknown member",
          avatar_url: member?.user.avatar_url,
          avatar_display: member?.user.avatar_display,
        };
      });
      const savedBits: Record<string, Bits> = {};
      for (const o of next)
        savedBits[o.target_id] = { allow: o.allow, deny: o.deny };
      // @everyone is always listed; with no stored override it inherits all.
      const everyone = roleList.find((r) => r.is_default);
      if (everyone && !next.some((o) => o.target_id === everyone.id)) {
        next.unshift({
          target_id: everyone.id,
          target_type: "role",
          allow: 0,
          deny: 0,
          name: everyone.name || "@everyone",
          color: everyone.color,
          isDefault: true,
        });
        savedBits[everyone.id] = { allow: 0, deny: 0 };
      }
      // Default role first, then roles, then members (stable within each).
      next.sort((a, b) => rank(a) - rank(b));
      setOverrides(next);
      setSaved(savedBits);
      setRoles(roleList);
      setMembers(memberList);
      setStatus("ready");
    } catch (err) {
      if (request !== requestRef.current) return;
      setLoadError(describeApiError(err, "load the permission overrides"));
      setStatus("error");
    }
  }, [channelId, serverId]);

  useEffect(() => {
    if (!enabled) return;
    void load();
  }, [enabled, load]);

  const isDirty = useCallback(
    (o: PermissionOverride) => {
      const bits = saved[o.target_id];
      return !bits || bits.allow !== o.allow || bits.deny !== o.deny;
    },
    [saved],
  );
  const dirtyIds = useMemo(
    () => overrides.filter(isDirty).map((o) => o.target_id),
    [isDirty, overrides],
  );

  const setPermission = useCallback(
    (targetId: string, mask: number, value: TriState) => {
      setJustSaved(false);
      setSaveError(null);
      setOverrides((prev) =>
        prev.map((o) =>
          o.target_id === targetId ? applyTriState(o, mask, value) : o,
        ),
      );
    },
    [],
  );

  const addOverride = useCallback(
    (target: { id: string; type: "role" | "user" }) => {
      setJustSaved(false);
      setOverrides((prev) => {
        if (prev.some((o) => o.target_id === target.id)) return prev;
        if (target.type === "role") {
          const role = roles.find((r) => r.id === target.id);
          return [
            ...prev,
            {
              target_id: target.id,
              target_type: "role" as const,
              allow: 0,
              deny: 0,
              name: role?.name ?? "Unknown role",
              color: role?.color,
            },
          ].sort((a, b) => rank(a) - rank(b));
        }
        const member = members.find((m) => m.user.id === target.id);
        return [
          ...prev,
          {
            target_id: target.id,
            target_type: "user" as const,
            allow: 0,
            deny: 0,
            name: memberName(member) || "Unknown member",
            avatar_url: member?.user.avatar_url,
            avatar_display: member?.user.avatar_display,
          },
        ];
      });
    },
    [members, roles],
  );

  /** Throws a user-facing message on failure. */
  const removeOverride = useCallback(
    async (targetId: string) => {
      if (saved[targetId]) {
        try {
          await apiDelete(`/api/channels/${channelId}/permissions/${targetId}`);
        } catch (err) {
          throw new Error(describeApiError(err, "remove this override"));
        }
      }
      setOverrides((prev) => prev.filter((o) => o.target_id !== targetId));
      setSaved((prev) => {
        const next = { ...prev };
        delete next[targetId];
        return next;
      });
    },
    [channelId, saved],
  );

  const reset = useCallback(() => {
    setSaveError(null);
    setJustSaved(false);
    setOverrides((prev) =>
      prev
        .filter((o) => saved[o.target_id])
        .map((o) => ({ ...o, ...saved[o.target_id] })),
    );
  }, [saved]);

  const save = useCallback(async () => {
    const pending = overrides.filter(isDirty);
    if (pending.length === 0 || saving) return;
    setSaving(true);
    setSaveError(null);
    const results = await Promise.allSettled(
      pending.map((o) =>
        apiPut(`/api/channels/${channelId}/permissions/${o.target_id}`, {
          target_type: o.target_type,
          allow: o.allow,
          deny: o.deny,
        }).then(() => o),
      ),
    );
    const done: Record<string, Bits> = {};
    let failure: unknown = null;
    for (const result of results) {
      if (result.status === "fulfilled") {
        done[result.value.target_id] = {
          allow: result.value.allow,
          deny: result.value.deny,
        };
      } else {
        failure ??= result.reason;
      }
    }
    setSaved((prev) => ({ ...prev, ...done }));
    setSaving(false);
    if (failure) {
      setSaveError(describeApiError(failure, "save the permission overrides"));
    } else {
      setJustSaved(true);
    }
  }, [channelId, isDirty, overrides, saving]);

  const availableRoles = roles.filter(
    (r) => !r.is_default && !overrides.some((o) => o.target_id === r.id),
  );
  const availableMembers = members.filter(
    (m) => !overrides.some((o) => o.target_id === m.user.id),
  );

  return {
    status,
    loadError,
    reload: load,
    overrides,
    availableRoles,
    availableMembers,
    isDirty,
    dirtyIds,
    setPermission,
    addOverride,
    removeOverride,
    reset,
    save,
    saving,
    saveError,
    justSaved,
  };
}

function rank(o: PermissionOverride) {
  if (o.isDefault) return 0;
  return o.target_type === "role" ? 1 : 2;
}
