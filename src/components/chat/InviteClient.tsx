import { apiGet, apiPost } from "@/lib/api-client";
import { buildAuthRouteUrl } from "@/lib/auth-route-urls";
import InlineEmojiText from "@/components/chat/InlineEmojiText";
import { HomeLink, PageState } from "@/components/PageState";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";

export interface InvitePreview {
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

type JoinResponse = {
  joined?: boolean;
  already_member?: boolean;
  server?: { name: string; id: string };
};

type InviteState =
  | { kind: "loading" }
  | { kind: "preview"; invite: InvitePreview; signedOut: boolean }
  | { kind: "signin"; invite: InvitePreview | null }
  | { kind: "joining"; invite: InvitePreview }
  | { kind: "joined"; server: { id: string; name: string } }
  | { kind: "member"; server: { id: string; name: string } }
  | { kind: "invalid"; reason: "missing" | "expired" }
  | { kind: "error"; invite: InvitePreview | null };

/** After joining, how long the success state shows before opening the server. */
export const INVITE_REDIRECT_MS = 1500;

const memberFormat = new Intl.NumberFormat("en-US");
const memberPlural = new Intl.PluralRules("en-US");

function memberCount(count: number): string {
  return memberPlural.select(count) === "one"
    ? `${memberFormat.format(count)} member`
    : `${memberFormat.format(count)} members`;
}

function statusOf(error: unknown): number | undefined {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : undefined;
}

function serverPath(serverId: string): string {
  return `/chat/${encodeURIComponent(serverId)}`;
}

/**
 * /invite/<code>. The preview is public, so signed-out visitors still see
 * the server; joining needs a session, so a 401 anywhere becomes "Sign in to
 * join" with a sign-in link that returns here. Server error text is never
 * shown: each status maps to written copy.
 */
export default function InviteClient({
  code: codeOverride,
  redirectMs = INVITE_REDIRECT_MS,
}: {
  /** Invite code; defaults to the `$code` route param (fixtures pass one). */
  code?: string;
  /** Success hold before opening the server (fixtures pass a long one). */
  redirectMs?: number;
} = {}) {
  const params = useParams({ strict: false }) as { code?: string };
  const code = codeOverride ?? params.code ?? "";
  const navigate = useNavigate();
  const [state, setState] = useState<InviteState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const redirectTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (redirectTimer.current !== null) {
        window.clearTimeout(redirectTimer.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (!code) return;
    let cancelled = false;

    const fetchPreview = async () => {
      const path = `/api/invites/${encodeURIComponent(code)}`;
      try {
        const invite = await apiGet<InvitePreview>(path);
        if (!cancelled) setState({ kind: "preview", invite, signedOut: false });
      } catch (error) {
        if (cancelled) return;
        const status = statusOf(error);
        if (status === 401) {
          // No session: the preview endpoint is public, so fetch it bare.
          try {
            const invite = await apiGet<InvitePreview>(path, {
              skipAuth: true,
            });
            if (!cancelled) {
              setState({ kind: "preview", invite, signedOut: true });
            }
          } catch (bareError) {
            if (cancelled) return;
            const bareStatus = statusOf(bareError);
            setState(
              bareStatus === 404 || bareStatus === 410
                ? {
                    kind: "invalid",
                    reason: bareStatus === 410 ? "expired" : "missing",
                  }
                : { kind: "signin", invite: null },
            );
          }
          return;
        }
        if (status === 404 || status === 410) {
          setState({
            kind: "invalid",
            reason: status === 410 ? "expired" : "missing",
          });
          return;
        }
        setState({ kind: "error", invite: null });
      }
    };

    void fetchPreview();
    return () => {
      cancelled = true;
    };
  }, [code, attempt]);

  const join = useCallback(
    async (invite: InvitePreview) => {
      setState({ kind: "joining", invite });
      try {
        const data = await apiPost<JoinResponse>(
          `/api/invites/${encodeURIComponent(code)}/join`,
          {},
        );
        const server = data.server ?? invite.server;
        if (data.already_member) {
          setState({ kind: "member", server });
          return;
        }
        if (!data.server) {
          setState({ kind: "error", invite });
          return;
        }
        setState({ kind: "joined", server });
        redirectTimer.current = window.setTimeout(() => {
          redirectTimer.current = null;
          void navigate({ href: serverPath(server.id) });
        }, redirectMs);
      } catch (error) {
        const status = statusOf(error);
        if (status === 401) setState({ kind: "signin", invite });
        else if (status === 404 || status === 410) {
          setState({
            kind: "invalid",
            reason: status === 410 ? "expired" : "missing",
          });
        } else setState({ kind: "error", invite });
      }
    },
    [code, navigate, redirectMs],
  );

  const signInHref = buildAuthRouteUrl("/sign-in", {
    redirect_url: `/invite/${encodeURIComponent(code ?? "")}`,
  });

  return (
    <>
      <p className="sr-only" role="status" aria-live="polite">
        {announcement(state)}
      </p>
      {renderState()}
    </>
  );

  function renderState() {
    switch (state.kind) {
      case "loading":
        return <InviteSkeleton />;
      case "preview":
      case "joining": {
        const joining = state.kind === "joining";
        const signedOut = state.kind === "preview" && state.signedOut;
        return (
          <InviteFrame invite={state.invite}>
            {signedOut ? (
              <Button asChild size="lg" className="w-full">
                <a href={signInHref}>Sign in to join</a>
              </Button>
            ) : (
              <Button
                size="lg"
                className="w-full"
                loading={joining}
                onClick={() => void join(state.invite)}
              >
                Accept invite
              </Button>
            )}
            <Button
              variant="ghost"
              size="lg"
              className="w-full"
              disabled={joining}
              onClick={() => void navigate({ to: signedOut ? "/" : "/chat" })}
            >
              No thanks
            </Button>
          </InviteFrame>
        );
      }
      case "signin":
        return state.invite ? (
          <InviteFrame
            invite={state.invite}
            note="Sign in to accept this invite."
          >
            <Button asChild size="lg" className="w-full">
              <a href={signInHref}>Sign in to join</a>
            </Button>
          </InviteFrame>
        ) : (
          <PageState
            icon="invite"
            title="Sign in to join"
            body="Sign in to see this invite and join the server."
          >
            <Button asChild>
              <a href={signInHref}>Sign in to join</a>
            </Button>
          </PageState>
        );
      case "joined":
        return (
          <PageState
            icon="success"
            title={
              <>
                Joined <InlineEmojiText text={state.server.name} />
              </>
            }
            body="Opening the server…"
          >
            <Button
              variant="secondary"
              onClick={() =>
                void navigate({ href: serverPath(state.server.id) })
              }
            >
              Open now
            </Button>
          </PageState>
        );
      case "member":
        return (
          <PageState
            icon="userCheck"
            title="You're already a member"
            body={
              <>
                You're already in <InlineEmojiText text={state.server.name} />.
              </>
            }
          >
            <Button
              onClick={() =>
                void navigate({ href: serverPath(state.server.id) })
              }
              className="max-w-full"
            >
              <span className="truncate">
                Open <InlineEmojiText text={state.server.name} />
              </span>
            </Button>
          </PageState>
        );
      case "invalid":
        return (
          <PageState
            icon="linkBroken"
            title="This invite isn't valid"
            body={
              state.reason === "expired"
                ? "It expired or has been used too many times. Ask for a new invite."
                : "The link may be mistyped, or the invite was deleted. Ask for a new invite."
            }
          >
            <HomeLink variant="secondary">Open Ralph Meet</HomeLink>
          </PageState>
        );
      case "error": {
        const invite = state.invite;
        return (
          <PageState
            icon="alert"
            tone="danger"
            title={
              invite ? "Couldn't join the server" : "Couldn't load this invite"
            }
            body="Check your connection and try again."
          >
            <Button
              onClick={() =>
                invite ? void join(invite) : setAttempt((n) => n + 1)
              }
            >
              Try again
            </Button>
            <HomeLink>Open Ralph Meet</HomeLink>
          </PageState>
        );
      }
    }
  }
}

function announcement(state: InviteState): string {
  switch (state.kind) {
    case "loading":
      return "Loading invite";
    case "joining":
      return `Joining ${state.invite.server.name}`;
    case "joined":
      return `Joined ${state.server.name}. Opening the server.`;
    case "member":
      return `You're already in ${state.server.name}.`;
    default:
      return "";
  }
}

/** 12.5 card with the server, plus the actions under it. */
function InviteFrame({
  invite,
  note = "You've been invited to join",
  children,
}: {
  invite: InvitePreview;
  note?: string;
  children: React.ReactNode;
}) {
  const inviter = invite.inviter.display_name ?? invite.inviter.username;
  return (
    <main className="flex min-h-dvh w-full items-center justify-center bg-rm-bg-primary px-4 py-12 text-rm-text">
      <div className="flex w-full max-w-[400px] flex-col gap-4">
        <h1 className="text-center text-ui-sm text-rm-text-secondary">
          {note}
        </h1>
        <section className="flex items-center gap-3 rounded-lg border border-rm-border bg-rm-bg-surface p-4">
          <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-rm-accent-tint text-ui-lg font-semibold text-rm-accent-ink">
            {invite.server.icon_url ? (
              <img
                src={invite.server.icon_url}
                alt=""
                className="size-full object-cover"
              />
            ) : (
              <span aria-hidden="true">
                {invite.server.name.charAt(0).toUpperCase()}
              </span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-ui-md font-semibold text-pretty break-words text-rm-text">
              <InlineEmojiText text={invite.server.name} />
            </h2>
            <p className="flex items-center gap-1.5 text-ui-sm text-rm-text-secondary">
              <Icon name="members" size="sm" className="shrink-0" />
              <span>{memberCount(invite.server.member_count)}</span>
            </p>
          </div>
        </section>
        <p className="text-center text-ui-xs text-rm-text-muted">
          Invited by{" "}
          <span className="font-medium text-rm-text-secondary">
            <InlineEmojiText text={inviter} />
          </span>
        </p>
        <div className="mt-2 flex flex-col gap-2">{children}</div>
      </div>
    </main>
  );
}

function InviteSkeleton() {
  return (
    <main
      aria-busy="true"
      className="flex min-h-dvh w-full items-center justify-center bg-rm-bg-primary px-4 py-12"
    >
      <div
        aria-hidden="true"
        className="flex w-full max-w-[400px] animate-pulse flex-col gap-4 motion-reduce:animate-none"
      >
        <div className="mx-auto h-3 w-44 rounded-md bg-rm-tint-1" />
        <div className="flex items-center gap-3 rounded-lg border border-rm-border bg-rm-bg-surface p-4">
          <div className="size-12 rounded-lg bg-rm-tint-1" />
          <div className="flex flex-1 flex-col gap-2">
            <div className="h-4 w-2/3 rounded-md bg-rm-tint-1" />
            <div className="h-3 w-1/3 rounded-md bg-rm-tint-1" />
          </div>
        </div>
        <div className="mt-2 h-10 rounded-md bg-rm-tint-1" />
      </div>
    </main>
  );
}
