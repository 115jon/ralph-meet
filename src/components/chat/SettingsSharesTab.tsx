import { apiDelete, apiGet } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { Check, Copy, ExternalLink, Eye, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

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
  if (share.expires_at && new Date(share.expires_at).getTime() <= Date.now()) return "expired";
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
    const ok = window.confirm("Revoke this public share link? Anyone with the link will see that it is gone.");
    if (!ok) return;

    setRevokingId(shareId);
    try {
      await apiDelete(`/api/shares/${shareId}`);
      setShares((prev) => prev.map((share) => (
        share.id === shareId
          ? { ...share, status: "revoked", revoked_at: new Date().toISOString() }
          : share
      )));
    } finally {
      setRevokingId(null);
    }
  };

  const copy = async (shareId: string, url: string) => {
    await navigator.clipboard.writeText(url);
    setCopiedId(shareId);
    window.setTimeout(() => {
      setCopiedId((current) => current === shareId ? null : current);
    }, 1800);
  };

  const currentShares = shares.filter((share) => effectiveStatus(share) === "active");
  const visibleShares = filter === "current" ? currentShares : shares;

  return (
    <div className="animate-in fade-in slide-in-from-right-4 duration-300">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3 md:mb-8">
        <div>
          <h1 className="mb-2 hidden text-2xl font-bold text-rm-text md:block">
            Shared Messages
          </h1>
          <p className="max-w-[560px] text-sm leading-6 text-rm-text-muted">
            Review your current public message snapshots, copy links, and revoke anything you no longer want available.
          </p>
        </div>
        <button
          onClick={loadShares}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg border border-rm-border px-3 py-2 text-xs font-bold text-rm-text-secondary transition hover:bg-rm-bg-hover disabled:opacity-50"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          Refresh
        </button>
      </div>

      <div className="mb-4 grid grid-cols-2 rounded-lg border border-rm-border bg-rm-bg-surface p-1">
        {[
          { id: "current" as const, label: `Current (${currentShares.length})` },
          { id: "all" as const, label: `All (${shares.length})` },
        ].map((item) => (
          <button
            key={item.id}
            onClick={() => setFilter(item.id)}
            className={cn(
              "rounded-md px-3 py-2 text-sm font-bold transition",
              filter === item.id
                ? "bg-primary text-primary-foreground"
                : "text-rm-text-muted hover:bg-rm-bg-hover hover:text-rm-text"
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-rm-text-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading shares...
        </div>
      ) : error ? (
        <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      ) : visibleShares.length === 0 ? (
        <div className="rounded-lg border border-rm-border bg-rm-bg-surface p-6 text-sm text-rm-text-muted">
          {filter === "current" ? "No current public shares." : "No public shares yet."}
        </div>
      ) : (
        <div className="space-y-3">
          {visibleShares.map((share) => {
            const url = `${window.location.origin}/share/${share.token}`;
            const status = effectiveStatus(share);
            const active = status === "active";
            return (
              <div key={share.id} className="rounded-lg border border-rm-border bg-rm-bg-surface p-4">
                <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-rm-text">
                      {share.author.display_name ?? share.author.username}
                    </p>
                    <p className="mt-1 line-clamp-2 text-sm leading-5 text-rm-text-secondary">
                      {share.content || "(attachment only)"}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "rounded-md border px-2 py-1 text-[11px] font-bold uppercase",
                      active
                        ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300"
                        : "border-rm-border text-rm-text-muted"
                    )}
                  >
                    {statusLabel(status)}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-rm-text-muted">
                  <span>Created {formatDate(share.created_at)}</span>
                  <span>Expires {formatDate(share.expires_at)}</span>
                  <span className="inline-flex items-center gap-1">
                    <Eye className="h-3 w-3" />
                    {share.view_count} views
                  </span>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    onClick={() => copy(share.id, url)}
                    disabled={!active}
                    className="inline-flex items-center gap-2 rounded-lg border border-rm-border px-3 py-2 text-xs font-bold text-rm-text-secondary transition hover:bg-rm-bg-hover disabled:opacity-40"
                  >
                    {copiedId === share.id ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    {copiedId === share.id ? "Copied" : "Copy"}
                  </button>
                  {active && (
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-2 rounded-lg border border-rm-border px-3 py-2 text-xs font-bold text-rm-text-secondary transition hover:bg-rm-bg-hover"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Open
                    </a>
                  )}
                  {active && (
                    <button
                      onClick={() => revoke(share.id)}
                      disabled={revokingId === share.id}
                      className="inline-flex items-center gap-2 rounded-lg border border-destructive/20 px-3 py-2 text-xs font-bold text-destructive transition hover:bg-destructive/10 disabled:opacity-40"
                    >
                      {revokingId === share.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      Revoke
                    </button>
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
