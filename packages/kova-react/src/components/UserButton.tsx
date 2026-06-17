/**
 * <UserButton /> — floating avatar button with a management dropdown.
 *
 * Drop-in user menu widget. Click the avatar to open a panel showing:
 *  - Current user identity (avatar, name, email)
 *  - Manage account link (opens settings page)
 *  - Multi-session switcher (when multiSession plugin is enabled)
 *  - Sign out action
 *
 * @example
 * ```tsx
 * // In your nav bar:
 * <UserButton afterSignOutUrl="/sign-in" showName />
 * ```
 */

import {
  type CSSProperties,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { mergeAppearance, useKovaAuth } from "../context";
import { useAuth } from "../hooks/use-auth";
import { useUser } from "../hooks/use-user";
import type { UserButtonProps } from "../types";
import { ConnectedAccounts } from "./ConnectedAccounts";
import {
  ChevronDownIcon,
  LinkIcon,
  LogOutIcon,
  SettingsIcon,
  UserIcon,
} from "./icons";
import { Avatar, Spinner } from "./ui";

// ── Multi-session device sessions ─────────────────────────────────────────────

type DeviceSession = {
  session: { token: string; userAgent?: string | null };
  user: {
    id: string;
    name?: string | null;
    email: string;
    image?: string | null;
  };
};

function MultiSessionSection({
  currentUserId,
  onClose,
}: {
  currentUserId: string;
  onClose: () => void;
}) {
  const { client } = useKovaAuth();
  const [sessions, setSessions] = useState<DeviceSession[]>([]);
  const [switching, setSwitching] = useState<string | null>(null);

  useEffect(() => {
    const ms = client as unknown as {
      multiSession?: {
        listDeviceSessions: () => Promise<{ data?: DeviceSession[] | null }>;
      };
    };
    ms.multiSession?.listDeviceSessions().then((res) => {
      setSessions(res.data ?? []);
    }).catch(() => setSessions([]));
  }, [client]);

  const others = sessions.filter((s) => s.user.id !== currentUserId);
  if (others.length === 0) return null;

  const handleSwitch = async (token: string) => {
    setSwitching(token);
    try {
      const ms = client as unknown as {
        multiSession?: {
          setActive: (o: { sessionToken: string }) => Promise<unknown>;
        };
      };
      await ms.multiSession?.setActive({ sessionToken: token });
      window.location.reload();
    } catch {
      setSwitching(null);
    } finally {
      onClose();
    }
  };

  return (
    <>
      <div
        style={{
          height: 1,
          background: "var(--ra-color-border)",
          margin: "4px 0",
        }}
      />
      <p
        style={{
          fontFamily: "var(--ra-font-mono)",
          fontSize: "0.6rem",
          color: "var(--ra-color-text-tertiary)",
          fontWeight: 600,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          padding: "5px 10px 3px",
        }}
      >
        Switch account
      </p>
      {others.map((s) => (
        <button
          key={s.session.token}
          type="button"
          data-ra-element="userButtonMenuItem"
          disabled={!!switching}
          onClick={() => void handleSwitch(s.session.token)}
          style={{ opacity: switching === s.session.token ? 0.6 : 1 }}
        >
          {switching === s.session.token ? (
            <Spinner size={14} />
          ) : (
            <Avatar
              src={s.user.image}
              name={s.user.name ?? s.user.email}
              size={20}
            />
          )}
          <span style={{ flex: 1, minWidth: 0 }}>
            <span
              style={{
                display: "block",
                fontFamily: "var(--ra-font-mono)",
                fontSize: "0.76rem",
                fontWeight: 600,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {s.user.name ?? s.user.email}
            </span>
            <span
              style={{
                display: "block",
                fontFamily: "var(--ra-font-mono)",
                fontSize: "0.64rem",
                color: "var(--ra-color-text-tertiary)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {s.user.email}
            </span>
          </span>
        </button>
      ))}
    </>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function UserButton({
  afterSignOutUrl,
  showName = false,
  size = 32,
  appearance: instanceAppearance,
  className,
}: UserButtonProps) {
  const { appearance: providerAppearance, afterSignOutUrl: providerUrl } =
    useKovaAuth();
  const merged = mergeAppearance(providerAppearance, instanceAppearance);
  const el = merged.elements ?? {};

  const { isLoaded, isSignedIn, signOut } = useAuth();
  const { user } = useUser();

  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [showLinkedAccounts, setShowLinkedAccounts] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        triggerRef.current?.contains(e.target as Node) ||
        menuRef.current?.contains(e.target as Node)
      )
        return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  const handleSignOut = useCallback(async () => {
    setSigningOut(true);
    setOpen(false);
    await signOut(afterSignOutUrl ?? providerUrl);
  }, [signOut, afterSignOutUrl, providerUrl]);

  if (!isLoaded) {
    // Skeleton avatar circle
    return (
      <div
        data-ra-root
        data-ra-element="skeleton"
        style={{ width: size, height: size, borderRadius: "50%" }}
      />
    );
  }

  if (!isSignedIn || !user) return null;

  // Compute menu position (above or below trigger)
  const menuStyle: CSSProperties = {
    ...el.userButtonMenu,
    // Position will be resolved by the parent; consumers typically put this
    // in a `position: relative` container.
    right: 0,
    top: "calc(100% + 6px)",
  };

  return (
    <div
      data-ra-root
      style={{ position: "relative", display: "inline-flex" }}
    >
      {/* Trigger */}
      <button
        ref={triggerRef}
        type="button"
        data-ra-element="userButtonTrigger"
        aria-label="User menu"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={el.userButtonTrigger}
        className={className}
      >
        {signingOut ? (
          <Spinner size={size} />
        ) : (
          <Avatar src={user.image} name={user.name} size={size} />
        )}
        {showName && (
          <span
            style={{
              fontFamily: "var(--ra-font-mono)",
              fontSize: "0.82rem",
              fontWeight: 500,
              color: "var(--ra-color-text)",
            }}
          >
            {user.name}
          </span>
        )}
        <ChevronDownIcon
          size={10}
          style={{
            color: "var(--ra-color-text-tertiary)",
            transform: open ? "rotate(180deg)" : "none",
            transition: "transform 0.15s",
          }}
        />
      </button>

      {/* Dropdown */}
      {open && (
        <div
          ref={menuRef}
          role="menu"
          data-ra-element="userButtonMenu"
          style={menuStyle}
        >
          {/* Identity header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 12px 8px",
              borderBottom: "1px solid var(--ra-color-border)",
            }}
          >
            <Avatar src={user.image} name={user.name} size={36} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <p
                style={{
                  fontFamily: "var(--ra-font-mono)",
                  fontSize: "0.82rem",
                  fontWeight: 600,
                  color: "var(--ra-color-text)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  letterSpacing: "-0.01em",
                }}
              >
                {user.name}
              </p>
              <p
                style={{
                  fontFamily: "var(--ra-font-mono)",
                  fontSize: "0.68rem",
                  color: "var(--ra-color-text-secondary)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {user.email}
              </p>
            </div>
          </div>

          {/* Actions */}
          <div style={{ padding: "4px 0" }}>
            <button
              type="button"
              role="menuitem"
              data-ra-element="userButtonMenuItem"
              style={el.userButtonMenuItem}
              onClick={() => {
                setOpen(false);
                window.location.href = "/settings";
              }}
            >
              <UserIcon size={14} />
              Manage account
            </button>
            <button
              type="button"
              role="menuitem"
              data-ra-element="userButtonMenuItem"
              style={el.userButtonMenuItem}
              onClick={() => {
                setOpen(false);
                window.location.href = "/settings";
              }}
            >
              <SettingsIcon size={14} />
              Settings
            </button>

            {/* Connected accounts — expandable accordion */}
            <button
              type="button"
              role="menuitem"
              data-ra-element="userButtonMenuItem"
              aria-expanded={showLinkedAccounts}
              style={el.userButtonMenuItem}
              onClick={() => setShowLinkedAccounts((v) => !v)}
            >
              <LinkIcon size={14} />
              <span style={{ flex: 1 }}>Connected accounts</span>
              <ChevronDownIcon
                size={10}
                style={{
                  color: "var(--ra-color-text-tertiary)",
                  transform: showLinkedAccounts ? "rotate(180deg)" : "none",
                  transition: "transform 0.15s",
                  flexShrink: 0,
                }}
              />
            </button>
            {showLinkedAccounts && (
              <div
                style={{
                  padding: "0 12px 4px",
                  borderBottom: "1px solid var(--ra-color-border)",
                }}
              >
                <ConnectedAccounts
                  callbackURL={window.location.pathname}
                  elements={el}
                />
              </div>
            )}

            {/* Multi-session switcher */}
            <MultiSessionSection
              currentUserId={user.id}
              onClose={() => setOpen(false)}
            />

            <div
              style={{
                height: 1,
                background: "var(--ra-color-border)",
                margin: "4px 0",
              }}
            />

            <button
              type="button"
              role="menuitem"
              data-ra-element="userButtonMenuItem"
              data-destructive="true"
              style={el.userButtonMenuItem}
              onClick={() => void handleSignOut()}
            >
              <LogOutIcon size={14} />
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
