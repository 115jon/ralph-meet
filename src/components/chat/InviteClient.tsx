import { apiGet, apiPost } from "@/lib/api-client";
import InlineEmojiText from "@/components/chat/InlineEmojiText";
import { useNavigate, useParams } from "@tanstack/react-router";
import { Icon } from "@/components/ui/icon";
import { useCallback, useEffect, useState } from "react";

interface InvitePreview {
  code: string;
  server: {
    id: string;
    name: string;
    icon_url: string | null;
    member_count: number;
  };
  inviter: {
    username: string;
    display_name: string | null;
    avatar_url: string | null;
  };
}

export default function InviteClient() {
  const { code } = useParams({ strict: false }) as { code: string };
  const navigate = useNavigate();
  const [status, setStatus] = useState<
    "loading" | "preview" | "joining" | "success" | "error"
  >("loading");
  const [invite, setInvite] = useState<InvitePreview | null>(null);
  const [errorMsg, setErrorMsg] = useState("");

  // Fetch invite preview
  useEffect(() => {
    if (!code) return;
    let cancelled = false;

    const fetchPreview = async () => {
      setStatus("loading");
      try {
        const data = await apiGet<InvitePreview>(`/api/invites/${code}`);
        if (cancelled) return;
        setInvite(data);
        setStatus("preview");
      } catch (err: any) {
        if (cancelled) return;
        setErrorMsg(err.message || "Invite not found");
        setStatus("error");
      }
    };

    void fetchPreview();

    return () => {
      cancelled = true;
    };
  }, [code]);

  const joinServer = useCallback(async () => {
    setStatus("joining");
    try {
      type JoinRes = {
        joined?: boolean;
        already_member?: boolean;
        server?: { name: string; id: string };
      };
      const data = await apiPost<JoinRes>(`/api/invites/${code}/join`, {});

      if (data.server) {
        setStatus("success");
        setTimeout(() => navigate({ to: "/chat" }), 1500);
      } else {
        setErrorMsg("Failed to join");
        setStatus("error");
      }
    } catch (err: any) {
      setErrorMsg(err.message || "Network error");
      setStatus("error");
    }
  }, [code, navigate]);

  return (
    <div className="flex h-full items-center justify-center bg-rm-bg-primary px-4 select-none">
      <div className="relative z-10 w-full max-w-[420px]">
        {/* Loading */}
        {status === "loading" && (
          <div className="flex flex-col items-center gap-4 rounded-2xl bg-rm-bg-secondary/80 p-10 shadow-2xl ring-1 ring-white/[0.06]">
            <Icon
              name="loader"
              size="2xl"
              className="animate-spin text-rm-accent"
            />
            <p className="text-ui-sm text-rm-text-muted">Loading invite...</p>
          </div>
        )}

        {/* Preview */}
        {status === "preview" && invite && (
          <div className="flex flex-col items-center gap-6 rounded-2xl bg-rm-bg-secondary/80 p-8 shadow-2xl ring-1 ring-white/[0.06]">
            {/* Invite badge */}
            <div className="flex items-center gap-2 rounded-full bg-rm-accent-dim px-3 py-1 ring-1 ring-rm-accent/20">
              <Icon name="link" size="sm" className="text-rm-accent" />
              <span className="text-ui-2xs font-semibold uppercase tracking-[0.08em] text-rm-accent">
                Invite
              </span>
            </div>

            <p className="text-ui-sm text-rm-text-muted -mt-2">
              You've been invited to join a server
            </p>

            {/* Server card */}
            <div className="flex w-full items-center gap-4 rounded-xl bg-rm-bg-primary/60 p-4 ring-1 ring-white/[0.06]">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-rm-accent-dim ring-1 ring-white/10 overflow-hidden">
                {invite.server.icon_url ? (
                  <img
                    src={invite.server.icon_url}
                    alt={invite.server.name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="text-ui-xl font-semibold text-white/80">
                    {invite.server.name.charAt(0).toUpperCase()}
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-ui-lg font-semibold text-rm-text">
                  <InlineEmojiText text={invite.server.name} />
                </h2>
                <div className="flex items-center gap-1.5 text-ui-sm text-rm-text-muted">
                  <Icon name="members" size="sm" />
                  <span>
                    {invite.server.member_count.toLocaleString()}{" "}
                    {invite.server.member_count === 1 ? "member" : "members"}
                  </span>
                </div>
              </div>
            </div>

            {/* Inviter info */}
            <p className="text-ui-xs text-rm-text-muted">
              Invited by{" "}
              <span className="font-semibold text-rm-text-secondary">
                <InlineEmojiText
                  text={invite.inviter.display_name ?? invite.inviter.username}
                />
              </span>
            </p>

            {/* Accept Button */}
            <button
              onClick={joinServer}
              className="w-full rounded-xl bg-rm-accent px-6 py-3.5 text-ui-sm font-semibold text-white shadow-lg shadow-rm-accent/20 transition-ui pointer-fine:hover:bg-rm-accent-hover pointer-fine:hover:shadow-rm-accent/30 active:scale-[0.98] cursor-pointer"
            >
              Accept Invite
            </button>

            {/* Decline link */}
            <button
              onClick={() => navigate({ to: "/chat" })}
              className="text-ui-xs text-rm-text-muted pointer-fine:hover:text-rm-text-secondary transition-colors"
            >
              No thanks
            </button>
          </div>
        )}

        {/* Joining */}
        {status === "joining" && (
          <div className="flex flex-col items-center gap-4 rounded-2xl bg-rm-bg-secondary/80 p-10 shadow-2xl ring-1 ring-white/[0.06]">
            <div className="relative">
              <Icon
                name="loader"
                size="2xl"
                className="animate-spin text-rm-accent"
              />
            </div>
            <p className="text-ui-sm font-medium text-rm-text">
              Joining <InlineEmojiText text={invite?.server.name ?? ""} />
              ...
            </p>
          </div>
        )}

        {/* Success */}
        {status === "success" && (
          <div className="flex flex-col items-center gap-4 rounded-2xl bg-rm-bg-secondary/80 p-10 shadow-2xl ring-1 ring-white/[0.06]">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/15 ring-1 ring-emerald-400/30">
              <Icon name="check" size="xl" className="text-emerald-400" />
            </div>
            <div className="text-center">
              <h2 className="text-ui-lg font-semibold text-rm-text">
                Joined <InlineEmojiText text={invite?.server.name ?? ""} />!
              </h2>
              <p className="mt-1 text-ui-sm text-rm-text-muted">
                Redirecting to chat...
              </p>
            </div>
          </div>
        )}

        {/* Error */}
        {status === "error" && (
          <div className="flex flex-col items-center gap-5 rounded-2xl bg-rm-bg-secondary/80 p-10 shadow-2xl ring-1 ring-white/[0.06]">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/15 ring-1 ring-destructive/30">
              <Icon name="close" size="xl" className="text-destructive" />
            </div>
            <div className="text-center">
              <h2 className="text-ui-lg font-semibold text-rm-text">
                Invite Invalid
              </h2>
              <p className="mt-1 text-ui-sm text-rm-text-muted">{errorMsg}</p>
            </div>
            <button
              onClick={() => navigate({ to: "/chat" })}
              className="rounded-xl bg-rm-bg-hover px-6 py-2.5 text-ui-sm font-medium text-rm-text ring-1 ring-white/[0.06] transition-colors pointer-fine:hover:bg-rm-bg-elevated"
            >
              Go to Chat
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
