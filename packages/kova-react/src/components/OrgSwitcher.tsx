/**
 * <OrgSwitcher /> — embeddable organization switcher.
 *
 * Renders a clickable trigger (org logo + name) that expands a dropdown
 * listing all organizations the user belongs to, plus a "Personal" option.
 * Switching organizations calls `organization.setActive()` and persists
 * server-side via Better Auth.
 *
 * @example
 * ```tsx
 * // In your sidebar:
 * <OrgSwitcher hideWhenNoOrgs />
 * ```
 */

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { mergeAppearance, useKovaAuth } from "../context";
import { useOrganization } from "../hooks/use-organization";
import type { OrgSwitcherProps, KovaOrganization } from "../types";
import { BuildingIcon, CheckIcon, ChevronDownIcon, UserIcon } from "./icons";
import { Spinner } from "./ui";

// ── Org logo / initials avatar ─────────────────────────────────────────────────

function OrgAvatar({
  name,
  logo,
  size = 24,
}: {
  name: string;
  logo?: string | null;
  size?: number;
}) {
  const [imgError, setImgError] = useState(false);

  const initial = name[0]?.toUpperCase() ?? "O";
  const base: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: 4,
    flexShrink: 0,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  };

  if (logo && !imgError) {
    return (
      <span style={base}>
        <img
          src={logo}
          alt={name}
          width={size}
          height={size}
          style={{ width: size, height: size, objectFit: "cover", borderRadius: 4 }}
          onError={() => setImgError(true)}
          referrerPolicy="no-referrer"
        />
      </span>
    );
  }

  return (
    <span
      style={{
        ...base,
        background: "var(--ra-color-primary)",
        fontFamily: "var(--ra-font-mono)",
        fontWeight: 700,
        fontSize: size * 0.44,
        color: "#fff",
      }}
    >
      {initial}
    </span>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function OrgSwitcher({
  hideWhenLoading = false,
  hideWhenNoOrgs = false,
  appearance: instanceAppearance,
  className,
}: OrgSwitcherProps) {
  const { client, appearance: providerAppearance } = useKovaAuth();
  const merged = mergeAppearance(providerAppearance, instanceAppearance);
  const el = merged.elements ?? {};

  const { organization: activeOrg, isLoaded } = useOrganization();
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);

  // Load all orgs the user belongs to
  const [orgs, setOrgs] = useState<KovaOrganization[] | null>(null);
  useEffect(() => {
    const orgClient = client as unknown as {
      organization?: {
        list: () => Promise<{
          data?: Array<{
            id: string;
            name: string;
            slug: string;
            logo?: string | null;
            metadata?: unknown;
            createdAt?: number | string;
          }> | null
        }>;
      };
    };
    orgClient.organization
      ?.list()
      .then((res) => {
        const raw = res.data ?? [];
        setOrgs(
          raw.map((o) => ({
            id: o.id,
            name: o.name,
            slug: o.slug,
            logo: o.logo ?? null,
            metadata: (o.metadata as Record<string, unknown> | null) ?? null,
            createdAt: new Date(o.createdAt ?? Date.now()),
          }))
        );
      })
      .catch(() => setOrgs([]));
  }, [client]);

  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleSetActive = useCallback(
    async (orgId: string | null) => {
      if (orgId === (activeOrg?.id ?? null) || switching) return;
      setSwitching(orgId ?? "__personal__");
      try {
        const orgClient = client as unknown as {
          organization?: {
            setActive: (o: { organizationId: string | null }) => Promise<unknown>;
          };
        };
        await orgClient.organization?.setActive({ organizationId: orgId });
        // Trigger a session refresh to update active org in the session cookie
        await client.getSession();
      } finally {
        setSwitching(null);
        setOpen(false);
      }
    },
    [client, activeOrg?.id, switching]
  );

  // Loading state
  if (!isLoaded && hideWhenLoading) return null;
  if (!isLoaded) {
    return (
      <div
        data-ra-root
        data-ra-element="skeleton"
        style={{ height: 38, borderRadius: "var(--ra-radius-sm)", width: "100%" }}
      />
    );
  }

  // No orgs
  if (orgs !== null && orgs.length === 0 && hideWhenNoOrgs) return null;

  return (
    <div
      ref={ref}
      data-ra-root
      style={{ position: "relative" }}
      className={className}
    >
      {/* Trigger button */}
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        data-ra-element="orgSwitcherTrigger"
        style={{
          ...el.orgSwitcherTrigger,
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 8,
          background: open ? "var(--ra-color-surface-raised)" : "transparent",
          border: "1px solid",
          borderColor: open ? "var(--ra-color-border)" : "transparent",
          borderRadius: "var(--ra-radius-sm)",
          padding: "6px 8px",
          cursor: "pointer",
          transition: "background 0.12s, border-color 0.12s",
        }}
        onClick={() => setOpen((v) => !v)}
      >
        {activeOrg ? (
          <OrgAvatar name={activeOrg.name} logo={activeOrg.logo} />
        ) : (
          <span
            style={{
              width: 24,
              height: 24,
              borderRadius: 4,
              flexShrink: 0,
              background: "var(--ra-color-surface-raised)",
              border: "1px solid var(--ra-color-border)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <BuildingIcon size={12} style={{ color: "var(--ra-color-text-tertiary)" }} />
          </span>
        )}

        <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
          <p
            style={{
              fontFamily: "var(--ra-font-mono)",
              fontSize: "0.78rem",
              fontWeight: 600,
              color: "var(--ra-color-text)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              letterSpacing: "-0.01em",
              margin: 0,
            }}
          >
            {activeOrg?.name ?? "Select organization"}
          </p>
          {activeOrg && (
            <p
              style={{
                fontFamily: "var(--ra-font-mono)",
                fontSize: "0.64rem",
                color: "var(--ra-color-text-tertiary)",
                margin: 0,
              }}
            >
              {activeOrg.slug}
            </p>
          )}
        </div>

        <ChevronDownIcon
          size={10}
          style={{
            color: "var(--ra-color-text-tertiary)",
            flexShrink: 0,
            transform: open ? "rotate(180deg)" : "none",
            transition: "transform 0.15s",
          }}
        />
      </button>

      {/* Dropdown */}
      {open && (
        <div
          role="listbox"
          data-ra-element="orgSwitcherMenu"
          style={{
            ...el.orgSwitcherMenu,
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            zIndex: 9999,
            background: "var(--ra-color-surface)",
            border: "1px solid var(--ra-color-border-strong)",
            borderRadius: "var(--ra-radius-sm)",
            padding: 4,
            boxShadow: "0 16px 40px rgba(0,0,0,0.6)",
          }}
        >
          <p
            style={{
              fontFamily: "var(--ra-font-mono)",
              fontSize: "0.58rem",
              color: "var(--ra-color-text-tertiary)",
              fontWeight: 600,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              padding: "5px 8px 3px",
              margin: 0,
            }}
          >
            Switch organization
          </p>

          {/* Personal / no-org */}
          <OrgOption
            label="Personal account"
            sublabel="No organization"
            isActive={activeOrg === null}
            isSwitching={switching === "__personal__"}
            icon={<UserIcon size={13} style={{ color: "var(--ra-color-text-tertiary)" }} />}
            onSelect={() => void handleSetActive(null)}
            el={el}
          />

          {orgs === null ? (
            <div
              style={{
                padding: "10px 8px",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <Spinner size={13} />
              <span
                style={{
                  fontFamily: "var(--ra-font-mono)",
                  fontSize: "0.75rem",
                  color: "var(--ra-color-text-tertiary)",
                }}
              >
                Loading…
              </span>
            </div>
          ) : (
            orgs.map((org) => (
              <OrgOption
                key={org.id}
                label={org.name}
                sublabel={org.slug}
                isActive={org.id === activeOrg?.id}
                isSwitching={switching === org.id}
                icon={<OrgAvatar name={org.name} logo={org.logo} size={22} />}
                onSelect={() => void handleSetActive(org.id)}
                el={el}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── OrgOption ─────────────────────────────────────────────────────────────────

function OrgOption({
  label,
  sublabel,
  isActive,
  isSwitching,
  icon,
  onSelect,
  el,
}: {
  label: string;
  sublabel?: string;
  isActive: boolean;
  isSwitching: boolean;
  icon: React.ReactNode;
  onSelect: () => void;
  el: import("../types").AppearanceElements;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={isActive}
      disabled={isSwitching}
      onClick={onSelect}
      data-ra-element="orgSwitcherOrgItem"
      style={{
        ...el.orgSwitcherOrgItem,
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 8px",
        borderRadius: 4,
        cursor: isActive ? "default" : "pointer",
        background: isActive ? "rgba(59,130,246,0.08)" : "transparent",
        border: isActive
          ? "1px solid rgba(59,130,246,0.15)"
          : "1px solid transparent",
        transition: "background 0.1s",
        marginBottom: 1,
        opacity: isSwitching ? 0.6 : 1,
      }}
    >
      {isSwitching ? <Spinner size={14} /> : icon}
      <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
        <p
          style={{
            fontFamily: "var(--ra-font-mono)",
            fontSize: "0.78rem",
            fontWeight: 600,
            color: isActive ? "var(--ra-color-primary)" : "var(--ra-color-text)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            letterSpacing: "-0.01em",
            margin: 0,
          }}
        >
          {isSwitching ? "Switching…" : label}
        </p>
        {sublabel && (
          <p
            style={{
              fontFamily: "var(--ra-font-mono)",
              fontSize: "0.64rem",
              color: "var(--ra-color-text-tertiary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              margin: 0,
            }}
          >
            {sublabel}
          </p>
        )}
      </div>
      {isActive && (
        <CheckIcon size={11} style={{ color: "var(--ra-color-primary)", flexShrink: 0 }} />
      )}
    </button>
  );
}
