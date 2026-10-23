import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { apiDelete, apiGet } from "@/lib/api-client";
import { describeApiError } from "@/lib/api-errors";
import { useClientReferenceTime } from "@/lib/client-date-format";
import { useCallback, useEffect, useState } from "react";
import {
  ConfirmStrip,
  RowError,
  SettingsCard,
  SettingsRow,
  useConfirm,
} from "./primitives";

function normalizeTimestamp(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== "string" || value.trim() === "") return null;

  const numericValue = Number(value);
  if (Number.isFinite(numericValue)) return numericValue;

  const parsedValue = Date.parse(value);
  return Number.isFinite(parsedValue) ? parsedValue : null;
}

function describeLastActive(value: unknown, now: number | null): string {
  const lastActiveAt = normalizeTimestamp(value);
  if (lastActiveAt === null || now === null) return "Unknown time";
  const minDiff = Math.floor((now - lastActiveAt) / 60000);
  if (minDiff < 1) return "less than a minute ago";
  if (minDiff < 60) return "less than an hour ago";
  if (minDiff < 1440) {
    const hours = Math.floor(minDiff / 60);
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  }
  const days = Math.floor(minDiff / 1440);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function SessionItem({
  session,
  onRevoke,
  now,
}: {
  session: any;
  onRevoke: (id: string) => Promise<void>;
  now: number | null;
}) {
  const {
    armed: confirmArmed,
    arm: armConfirm,
    cancel: cancelConfirm,
    done: finishConfirm,
    triggerRef: confirmTriggerRef,
  } = useConfirm();
  const [revoking, setRevoking] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const isMobile = Boolean(session.activity?.isMobile);
  const browserName =
    session.activity?.browserName ||
    (isMobile ? "Mobile client" : "Desktop client");
  const deviceType =
    session.activity?.deviceType || (isMobile ? "Mobile" : "Desktop");
  const title = `${deviceType} · ${browserName}`;
  const location =
    [session.activity?.city, session.activity?.country]
      .filter(Boolean)
      .join(", ") || "Unknown location";
  const timeAgo = describeLastActive(session.lastActiveAt, now);

  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-rm-tint-2 text-rm-text">
          <Icon name={isMobile ? "mobile" : "monitor"} size="md" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-ui-sm font-medium text-rm-text">
            {title}
          </p>
          <p className="truncate text-ui-sm text-rm-text-secondary">
            {session.isCurrent
              ? `${location} · Active now`
              : `${location} · ${timeAgo}`}
          </p>
        </div>
        {!session.isCurrent && !confirmArmed ? (
          <Button
            ref={confirmTriggerRef}
            type="button"
            variant="secondary"
            size="sm"
            aria-label={`Sign out ${title}`}
            onClick={armConfirm}
          >
            Sign out
          </Button>
        ) : null}
      </div>
      {confirmArmed ? (
        <ConfirmStrip
          consequence={`${title} will be signed out and need to sign in again.`}
          confirmLabel="Sign out device"
          busy={revoking}
          error={revokeError}
          onCancel={() => {
            setRevokeError(null);
            cancelConfirm();
          }}
          onConfirm={() => {
            setRevoking(true);
            setRevokeError(null);
            onRevoke(session.id)
              .then(() => finishConfirm())
              .catch((err: unknown) =>
                setRevokeError(describeApiError(err, "sign out this device")),
              )
              .finally(() => setRevoking(false));
          }}
        />
      ) : null}
    </li>
  );
}

/** Placeholder rows at the real row height while sessions load. */
function SessionSkeleton() {
  return (
    <div role="status" className="flex flex-col gap-3">
      <span className="sr-only">Loading sessions</span>
      {[0, 1].map((index) => (
        <div key={index} aria-hidden="true" className="flex items-center gap-3">
          <span className="size-10 shrink-0 animate-pulse rounded-full bg-rm-tint-1 motion-reduce:animate-none" />
          <span className="flex flex-1 flex-col gap-1.5">
            <span className="h-4 w-40 max-w-full animate-pulse rounded-xs bg-rm-tint-1 motion-reduce:animate-none" />
            <span className="h-3 w-56 max-w-full animate-pulse rounded-xs bg-rm-tint-1 motion-reduce:animate-none" />
          </span>
        </div>
      ))}
    </div>
  );
}

export default function SessionsPanel() {
  const [sessions, setSessions] = useState<any[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const referenceTime = useClientReferenceTime();

  const fetchSessions = useCallback(async () => {
    setSessionsLoading(true);
    setLoadError(null);
    try {
      const data = await apiGet<{ sessions: any[] }>("/api/sessions");
      setSessions(data.sessions);
    } catch (err: unknown) {
      setLoadError(describeApiError(err, "load your sessions"));
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchSessions();
  }, [fetchSessions]);

  /** Throws on failure; the row shows the error in its confirm strip. */
  const handleRevokeSession = async (sessionId: string) => {
    await apiDelete("/api/sessions", { sessionId });
    setSessions((prev) => prev.filter((s) => s.id !== sessionId));
  };

  const currentSessions = sessions.filter((session) => session.isCurrent);
  const otherSessions = sessions.filter((session) => !session.isCurrent);
  const loadingFirst = sessionsLoading && sessions.length === 0;
  // Nothing is known about other devices until a load succeeds.
  const unknown = loadingFirst || (Boolean(loadError) && sessions.length === 0);

  return (
    <>
      <SettingsCard id="this-device">
        <SettingsRow id="current-session" layout="block" hideLabel>
          {() =>
            loadingFirst ? (
              <SessionSkeleton />
            ) : loadError ? (
              <div className="flex flex-col items-start gap-2">
                <RowError className="mt-0 self-stretch">{loadError}</RowError>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  loading={sessionsLoading}
                  onClick={() => void fetchSessions()}
                >
                  <Icon name="refresh" size="sm" />
                  Try again
                </Button>
              </div>
            ) : currentSessions.length > 0 ? (
              <ul>
                {currentSessions.map((session) => (
                  <SessionItem
                    key={session.id}
                    session={session}
                    onRevoke={handleRevokeSession}
                    now={referenceTime}
                  />
                ))}
              </ul>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-ui-sm text-rm-text-secondary">
                  We couldn't find this device's session.
                </p>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => void fetchSessions()}
                >
                  <Icon name="refresh" size="sm" />
                  Reload
                </Button>
              </div>
            )
          }
        </SettingsRow>
      </SettingsCard>

      <SettingsCard id="other-devices">
        <SettingsRow id="other-sessions" layout="block" hideLabel>
          {() =>
            unknown ? (
              loadingFirst ? (
                <SessionSkeleton />
              ) : (
                <p className="text-ui-sm text-rm-text-secondary">
                  Your other devices show here once your sessions load.
                </p>
              )
            ) : otherSessions.length > 0 ? (
              <ul className="divide-y divide-rm-border">
                {otherSessions.map((session) => (
                  <SessionItem
                    key={session.id}
                    session={session}
                    onRevoke={handleRevokeSession}
                    now={referenceTime}
                  />
                ))}
              </ul>
            ) : (
              <p className="text-ui-sm text-rm-text-secondary">
                No other devices are signed in.
              </p>
            )
          }
        </SettingsRow>
      </SettingsCard>
    </>
  );
}
