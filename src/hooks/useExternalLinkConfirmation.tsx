import {
  ExternalLinkConfirmModal,
  type PendingExternalLink,
} from "@/components/ui/ExternalLinkConfirmModal";
import { isDesktop } from "@/lib/platform";
import { useCallback, useMemo, useState } from "react";

const TRUSTED_EXTERNAL_DOMAINS_KEY = "ralph-meet:trusted-external-link-domains";

function readTrustedDomains(): string[] {
  if (typeof window === "undefined") return [];

  try {
    const value = window.localStorage.getItem(TRUSTED_EXTERNAL_DOMAINS_KEY);
    const parsed: unknown = value ? JSON.parse(value) : [];
    return Array.isArray(parsed)
      ? parsed.filter((domain): domain is string => typeof domain === "string")
      : [];
  } catch {
    return [];
  }
}

function writeTrustedDomain(hostname: string): void {
  try {
    const domains = new Set(readTrustedDomains());
    domains.add(hostname);
    window.localStorage.setItem(
      TRUSTED_EXTERNAL_DOMAINS_KEY,
      JSON.stringify([...domains].sort()),
    );
  } catch {
    // Trust is an enhancement; opening the link should still work if storage fails.
  }
}

function parseExternalUrl(value: string): URL | null {
  try {
    const parsed = new URL(
      value,
      typeof window !== "undefined"
        ? window.location.href
        : "https://localhost",
    );
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function isLeavingApplication(url: URL): boolean {
  if (typeof window === "undefined") return true;
  return url.origin !== window.location.origin;
}

async function openExternalUrl(url: string): Promise<void> {
  if (isDesktop()) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
    return;
  }

  window.open(url, "_blank", "noopener,noreferrer");
}

export function useExternalLinkConfirmation() {
  const [pending, setPending] = useState<PendingExternalLink | null>(null);
  const [renderedPending, setRenderedPending] =
    useState<PendingExternalLink | null>(null);
  const [trustDomain, setTrustDomain] = useState(false);

  const requestOpen = useCallback((value: string) => {
    const parsed = parseExternalUrl(value);
    if (!parsed) return;

    if (!isLeavingApplication(parsed)) {
      void openExternalUrl(parsed.toString());
      return;
    }

    const hostname = parsed.hostname.toLowerCase();
    if (readTrustedDomains().includes(hostname)) {
      void openExternalUrl(parsed.toString());
      return;
    }

    setTrustDomain(false);
    const nextPending = { url: parsed.toString(), hostname };
    setRenderedPending(nextPending);
    setPending(nextPending);
  }, []);

  const closeConfirmation = useCallback(() => {
    setPending(null);
    setTrustDomain(false);
  }, []);

  const confirmOpen = useCallback(() => {
    if (!pending) return;
    if (trustDomain) writeTrustedDomain(pending.hostname);

    const url = pending.url;
    closeConfirmation();
    void openExternalUrl(url);
  }, [closeConfirmation, pending, trustDomain]);

  const confirmation = useMemo(
    () => (
      <ExternalLinkConfirmModal
        open={pending !== null}
        pending={renderedPending ?? { url: "", hostname: "" }}
        trustDomain={trustDomain}
        onTrustDomainChange={setTrustDomain}
        onClose={closeConfirmation}
        onConfirm={confirmOpen}
      />
    ),
    [closeConfirmation, confirmOpen, pending, renderedPending, trustDomain],
  );

  return { requestOpen, confirmation };
}
