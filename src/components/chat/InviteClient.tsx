import { apiGet, apiPost } from "@/lib/api-client";
import { buildAuthRouteUrl } from "@/lib/auth-route-urls";
import InlineEmojiText from "@/components/chat/InlineEmojiText";
import {
  PublicActions,
  PublicBody,
  PublicFrame,
  PublicKicker,
  PublicTitle,
  StatusTile,
} from "@/components/auth/PublicFrame";
import { HomeLink, PageState } from "@/components/PageState";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Skeleton } from "@/components/ui/skeleton";
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
              <Button asChild size="lg">
                <a href={signInHref}>Sign in to join</a>
              </Button>
            ) : (
              <Button
                size="lg"
                loading={joining}
                onClick={() => void join(state.invite)}
              >
                Accept invite
              </Button>
            )}
            <Button
              variant="ghost"
              size="lg"
              disabled={joining}
              onClick={() => {
                // A signed-out visitor came from somewhere else (a chat, a
                // message); send them back there rather than to the landing.
                if (signedOut && window.history.length > 1) {
                  window.history.back();
                  return;
                }
                void navigate({ to: signedOut ? "/" : "/chat" });
              }}
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
            <Button asChild size="lg">
              <a href={signInHref}>Sign in to join</a>
            </Button>
          </InviteFrame>
        ) : (
          <PageState
            icon="invite"
            title="Sign in to join"
            body="Sign in to see this invite and join the server."
          >
            <Button asChild size="lg">
              <a href={signInHref}>Sign in to join</a>
            </Button>
          </PageState>
        );
      case "joined":
        return (
          <PageState
            icon="check"
            tone="success"
            title={
              <>
                Joined <InlineEmojiText text={state.server.name} />
              </>
            }
            body="Opening the server…"
          >
            <Button
              size="lg"
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
              size="lg"
              onClick={() =>
                void navigate({ href: serverPath(state.server.id) })
              }
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
            <HomeLink variant="primary" href="/chat">
              Open Ralph Meet
            </HomeLink>
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
              size="lg"
              onClick={() =>
                invite ? void join(invite) : setAttempt((n) => n + 1)
              }
            >
              Try again
            </Button>
            <HomeLink href="/chat">Open Ralph Meet</HomeLink>
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

/**
 * The invite on the public frame: the server's icon in the status tile, who
 * invited you as a sentence-case lead-in, the server name as the display
 * heading, how many are there, then the actions. No card inside the frame.
 */
function InviteFrame({
  invite,
  note,
  children,
}: {
  invite: InvitePreview;
  /** A line under the heading (e.g. "Sign in to accept this invite."). */
  note?: string;
  children: React.ReactNode;
}) {
  const inviter = invite.inviter.display_name ?? invite.inviter.username;
  return (
    <PublicFrame>
      <StatusTile tone="accent">
        {invite.server.icon_url ? (
          <img
            src={invite.server.icon_url}
            alt=""
            className="size-full object-cover"
          />
        ) : (
          <span className="text-ui-xl font-semibold">
            {invite.server.name.charAt(0).toUpperCase()}
          </span>
        )}
      </StatusTile>
      <PublicKicker>
        Invite <span aria-hidden="true">·</span>
        <span className="sr-only">from</span>{" "}
        <span className="text-ink-2">
          <InlineEmojiText text={inviter} />
        </span>
      </PublicKicker>
      <PublicTitle size="display" className="break-words">
        <InlineEmojiText text={invite.server.name} />
      </PublicTitle>
      {note ? <PublicBody size="lead">{note}</PublicBody> : null}
      <p className="silkscreen mt-4 flex h-5 items-center gap-2 text-ink-3">
        <Icon name="members" size="xs" className="shrink-0" />
        <span>{memberCount(invite.server.member_count)}</span>
      </p>
      <PublicActions>{children}</PublicActions>
    </PublicFrame>
  );
}

/** The loaded invite's exact geometry, as static placeholders (no pulse). */
function InviteSkeleton() {
  return (
    <PublicFrame aria-busy>
      <div aria-hidden="true">
        <Skeleton className="mb-6 size-12 rounded-[2px]" />
        <div className="mb-4 flex h-[14px] items-center">
          <Skeleton className="h-2.5 w-1/2" />
        </div>
        <div className="flex h-[0.9em] items-center text-[length:clamp(2.75rem,2.2rem+2.6vw,4.25rem)]">
          <Skeleton className="h-[0.7em] w-3/4" />
        </div>
        <Skeleton className="mt-6 h-2" />
        <div className="mt-4 flex h-5 items-center">
          <Skeleton className="h-2.5 w-24" />
        </div>
        <div className="mt-8 flex flex-col gap-3">
          <Skeleton className="h-12 rounded-[2px]" />
          <Skeleton className="h-12 rounded-[2px]" />
        </div>
      </div>
    </PublicFrame>
  );
}
