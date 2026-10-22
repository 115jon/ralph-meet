import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiDelete, apiGet } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";
import { useEffect, useState } from "react";
import InlineEmojiText from "./InlineEmojiText";

interface ShareListItem {
  id: string;
  token: string;
  content: string;
  author: {
    username: string;
    display_name: string | null;
  };
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  status: "active" | "revoked" | "deleted" | "expired";
  view_count: number;
}

function formatDate(value: string | null): string {
  if (!value) return "Never";
  return new Date(value).toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function effectiveStatus(share: ShareListItem): ShareListItem["status"] {
  if (share.status !== "active") return share.status;
  if (share.revoked_at) return "revoked";
  if (share.expires_at && new Date(share.expires_at).getTime() <= Date.now())
    return "expired";
  return "active";
}

function statusLabel(status: ShareListItem["status"]): string {
  switch (status) {
    case "active":
      return "Current";
    case "revoked":
      return "Revoked";
    case "deleted":
      return "Deleted";
    case "expired":
      return "Expired";
  }
}

export default function SettingsSharesTab() {
  const [shares, setShares] = useState<ShareListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"current" | "all">("current");

  const loadShares = () => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiGet<{ shares: ShareListItem[] }>("/api/shares")
      .then((data) => {
        if (!cancelled) setShares(data.shares);
      })
      .catch((err: any) => {
        if (!cancelled) {
          setShares([]);
          setError(err?.message || "Could not load shared messages.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  };

  useEffect(() => loadShares(), []);

  const revoke = async (shareId: string) => {
    const ok = window.confirm(
      "Revoke this public share link? Anyone with the link will see that it is gone.",
    );
    if (!ok) return;

    setRevokingId(shareId);
    try {
      await apiDelete(`/api/shares/${shareId}`);
      setShares((prev) =>
        prev.map((share) =>
          share.id === shareId
            ? {
                ...share,
                status: "revoked",
                revoked_at: new Date().toISOString(),
              }
            : share,
        ),
      );
    } finally {
      setRevokingId(null);
    }
  };

  const copy = async (shareId: string, url: string) => {
    await navigator.clipboard.writeText(url);
    setCopiedId(shareId);
    window.setTimeout(() => {
      setCopiedId((current) => (current === shareId ? null : current));
    }, 1800);
  };

  const currentShares = shares.filter(
    (share) => effectiveStatus(share) === "active",
  );
  const visibleShares = filter === "current" ? currentShares : shares;

  return (
    <div className="animate-in fade-in duration-150">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3 md:mb-8">
        <div>
          <h1 className="mb-2 hidden text-2xl font-bold text-rm-text md:block">
            Shared Messages
          </h1>
          <p className="max-w-[560px] text-sm leading-6 text-rm-text-muted">
            Review your current public message snapshots, copy links, and revoke
            anything you no longer want available.
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={loadShares}
          disabled={loading}
        >
          <Icon
            name="refresh"
            size="sm"
            className={cn(loading && "animate-spin")}
          />
          Refresh
        </Button>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-1 rounded-lg border border-rm-border bg-rm-bg-surface p-1">
        {[
          {
            id: "current" as const,
            label: `Current (${currentShares.length})`,
          },
          { id: "all" as const, label: `All (${shares.length})` },
        ].map((item) => (
          <Button
            key={item.id}
            variant="ghost"
            onClick={() => setFilter(item.id)}
            aria-pressed={filter === item.id}
            className={cn(
              "w-full",
              filter === item.id
                ? "bg-rm-tint-2 text-rm-text"
                : "text-rm-text-secondary pointer-fine:hover:text-rm-text",
            )}
          >
            {item.label}
          </Button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-rm-text-muted">
          <Icon name="loader" size="sm" className="animate-spin" />
          Loading shares...
        </div>
      ) : error ? (
        <div className="rounded-xl bg-rm-danger-tint p-4 text-sm text-rm-danger-ink">
          {error}
        </div>
      ) : visibleShares.length === 0 ? (
        <div className="rounded-xl border border-rm-border bg-rm-bg-surface p-6 text-sm text-rm-text-muted">
          {filter === "current"
            ? "No current public shares."
            : "No public shares yet."}
        </div>
      ) : (
        <div className="space-y-3">
          {visibleShares.map((share) => {
            const url = `${window.location.origin}/share/${share.token}`;
            const status = effectiveStatus(share);
            const active = status === "active";
            return (
              <div
                key={share.id}
                className="rounded-xl border border-rm-border bg-rm-bg-surface p-4"
              >
                <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-rm-text">
                      <InlineEmojiText
                        text={
                          share.author.display_name ?? share.author.username
                        }
                      />
                    </p>
                    <p className="mt-1 line-clamp-2 text-sm leading-5 text-rm-text-secondary">
                      <InlineEmojiText
                        text={share.content || "(attachment only)"}
                      />
                    </p>
                  </div>
                  <Badge
                    variant={active ? "secondary" : "outline"}
                    className={
                      active ? "text-rm-success-ink" : "text-rm-text-muted"
                    }
                  >
                    {statusLabel(status)}
                  </Badge>
                </div>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-rm-text-muted">
                  <span>Created {formatDate(share.created_at)}</span>
                  <span>Expires {formatDate(share.expires_at)}</span>
                  <span className="inline-flex items-center gap-1">
                    <Icon name="eye" size="xs" />
                    {share.view_count} views
                  </span>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => copy(share.id, url)}
                    disabled={!active}
                  >
                    {copiedId === share.id ? (
                      <Icon name="check" size="sm" />
                    ) : (
                      <Icon name="copy" size="sm" />
                    )}
                    {copiedId === share.id ? "Copied" : "Copy"}
                  </Button>
                  {active && (
                    <Button asChild variant="secondary" size="sm">
                      <a href={url} target="_blank" rel="noreferrer">
                        <Icon name="externalLink" size="sm" />
                        Open
                      </a>
                    </Button>
                  )}
                  {active && (
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => revoke(share.id)}
                      disabled={revokingId === share.id}
                    >
                      {revokingId === share.id ? (
                        <Icon
                          name="loader"
                          size="sm"
                          className="animate-spin"
                        />
                      ) : (
                        <Icon name="trash" size="sm" />
                      )}
                      Revoke
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
