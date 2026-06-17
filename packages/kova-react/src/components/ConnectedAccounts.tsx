/**
 * <ConnectedAccounts /> — displays all provider accounts linked to the
 * current user and lets them connect additional providers.
 *
 * Designed to be embedded in <UserButton>'s dropdown menu and in standalone
 * profile/settings pages.
 *
 * Visual spec:
 *  - Each row shows: provider icon + label + connected badge (or Connect button)
 *  - "credential" provider is shown as "Password" with a key icon
 *  - Loading state shows skeletons; error state shows a subtle alert
 *  - All interaction states match the existing UserButton menu aesthetic
 */

import { useCallback, useState } from "react";
import { useKovaAuth } from "../context";
import { useLinkedAccounts } from "../hooks/use-linked-accounts";
import type { AppearanceElements } from "../types";
import { CheckIcon, KeyIcon, ProviderIcon, providerLabel } from "./icons";
import { Alert, Spinner } from "./ui";

// ── Known providers to always render (connected or not) ──────────────────────
//
// We show a row for each known provider so the user can see what's available
// to connect, not just what's already connected.  The list here is the
// intersection of providers that better-auth supports server-side.

const KNOWN_PROVIDERS = [
  "credential",
  "google",
  "discord",
  "github",
  "microsoft",
  "apple",
  "facebook",
] as const;

type KnownProvider = (typeof KNOWN_PROVIDERS)[number];

interface ConnectedAccountsProps {
  /**
   * If set, only show rows for these providers (defaults to all KNOWN_PROVIDERS).
   * Useful for pages that only want to show the social providers.
   */
  providers?: KnownProvider[];
  /**
   * URL redirected to after a successful OAuth link.
   * Defaults to the current page URL.
   */
  callbackURL?: string;
  /** Appearance element overrides. */
  elements?: AppearanceElements;
  /** Compact = single column list (default). Wide = 2-col grid when space allows. */
  layout?: "compact" | "wide";
}

// ── Provider label overrides for special cases ────────────────────────────────

function displayLabel(providerId: string): string {
  if (providerId === "credential") return "Password / Email";
  return providerLabel(providerId);
}

function ProviderDisplayIcon({ provider }: { provider: string }) {
  if (provider === "credential") {
    return <KeyIcon size={15} style={{ color: "var(--ra-color-text-secondary)" }} />;
  }
  return <ProviderIcon provider={provider} size={15} />;
}

// ── Main component ─────────────────────────────────────────────────────────────

export function ConnectedAccounts({
  providers = [...KNOWN_PROVIDERS],
  callbackURL,
  elements,
  layout = "compact",
}: ConnectedAccountsProps) {
  const { oauthProviders } = useKovaAuth();

  const { accounts, isLoaded, isUpdating, error, linkAccount } =
    useLinkedAccounts();

  const [linkingProvider, setLinkingProvider] = useState<string | null>(null);

  const handleLink = useCallback(
    async (providerId: string) => {
      setLinkingProvider(providerId);
      await linkAccount({
        provider: providerId,
        callbackURL: callbackURL ?? window.location.pathname,
      });
      // If we get here the redirect did NOT happen (error).
      setLinkingProvider(null);
    },
    [linkAccount, callbackURL]
  );

  // Filter providers: always include credential; for OAuth ones, only show if
  // configured in the <KovaAuthProvider oauthProviders> list.
  const activeOAuthIds = new Set(oauthProviders.map((p) => p.id));
  const visibleProviders = providers.filter(
    (p) => p === "credential" || activeOAuthIds.has(p)
  );

  const connectedIds = new Set(accounts.map((a) => a.providerId));

  if (!isLoaded) {
    return (
      <div
        data-ra-element="connectedAccountsSection"
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
          padding: "8px 0",
          ...elements?.connectedAccountsSection,
        }}
      >
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            data-ra-element="skeleton"
            style={{ height: 32, borderRadius: 6, opacity: 0.3 + i * 0.1 }}
          />
        ))}
      </div>
    );
  }

  const gridStyle =
    layout === "wide"
      ? {
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
        gap: 6,
      }
      : {
        display: "flex",
        flexDirection: "column" as const,
        gap: 4,
      };

  return (
    <div
      data-ra-element="connectedAccountsSection"
      style={{ ...elements?.connectedAccountsSection }}
    >
      {error && (
        <Alert variant="error" style={{ marginBottom: 8, fontSize: "0.75rem" }}>
          {error}
        </Alert>
      )}

      <div style={gridStyle}>
        {visibleProviders.map((providerId) => {
          const isConnected = connectedIds.has(providerId);
          const isLinking = linkingProvider === providerId;
          const busy = isUpdating || !!linkingProvider;

          return (
            <div
              key={providerId}
              data-ra-element="connectedAccountsItem"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "5px 0",
                ...elements?.connectedAccountsItem,
              }}
            >
              {/* Provider icon + name */}
              <ProviderDisplayIcon provider={providerId} />
              <span
                data-ra-element="connectedAccountsItemLabel"
                style={{
                  flex: 1,
                  fontFamily: "var(--ra-font-mono)",
                  fontSize: "0.76rem",
                  color: isConnected
                    ? "var(--ra-color-text)"
                    : "var(--ra-color-text-secondary)",
                  ...elements?.connectedAccountsItemLabel,
                }}
              >
                {displayLabel(providerId)}
              </span>

              {/* Status / action */}
              {isConnected ? (
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 3,
                    fontFamily: "var(--ra-font-mono)",
                    fontSize: "0.64rem",
                    color: "var(--ra-color-success)",
                    fontWeight: 600,
                  }}
                  title="Connected"
                >
                  <CheckIcon size={11} />
                  Connected
                </span>
              ) : providerId === "credential" ? (
                // credential = password — can't link via OAuth redirect
                <span
                  style={{
                    fontFamily: "var(--ra-font-mono)",
                    fontSize: "0.64rem",
                    color: "var(--ra-color-text-tertiary)",
                  }}
                >
                  Not set
                </span>
              ) : (
                <button
                  type="button"
                  data-ra-element="connectedAccountsConnectButton"
                  disabled={busy}
                  onClick={() => void handleLink(providerId)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "3px 8px",
                    borderRadius: "var(--ra-radius-sm, 5px)",
                    border: "1px solid var(--ra-color-border-strong)",
                    background: "transparent",
                    color: "var(--ra-color-primary)",
                    fontFamily: "var(--ra-font-mono)",
                    fontSize: "0.64rem",
                    fontWeight: 600,
                    cursor: busy ? "not-allowed" : "pointer",
                    opacity: busy ? 0.6 : 1,
                    transition: "opacity 0.15s, border-color 0.15s",
                    ...elements?.connectedAccountsConnectButton,
                  }}
                  aria-label={`Connect ${displayLabel(providerId)}`}
                >
                  {isLinking ? <Spinner size={10} /> : null}
                  {isLinking ? "Connecting…" : "Connect"}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
