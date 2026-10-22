import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { apiDelete, apiGet } from "@/lib/api-client";
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
          onCancel={cancelConfirm}
          onConfirm={() => {
            setRevoking(true);
            void onRevoke(session.id).finally(() => {
              setRevoking(false);
              finishConfirm();
            });
          }}
        />
      ) : null}
    </li>
  );
}

export default function SessionsPanel() {
  const [sessions, setSessions] = useState<any[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const referenceTime = useClientReferenceTime();

  const fetchSessions = useCallback(async () => {
    setSessionsLoading(true);
    setSessionError(null);
    try {
      const data = await apiGet<{ sessions: any[] }>("/api/sessions");
      setSessions(data.sessions);
    } catch (err: any) {
      setSessionError(err.message || "Couldn't load sessions. Try again.");
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchSessions();
  }, [fetchSessions]);

  const handleRevokeSession = async (sessionId: string) => {
    try {
      await apiDelete("/api/sessions", { sessionId });
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    } catch (err: any) {
      setSessionError(err.message || "Couldn't sign out that device.");
    }
  };

  const currentSessions = sessions.filter((session) => session.isCurrent);
  const otherSessions = sessions.filter((session) => !session.isCurrent);
  const loadingFirst = sessionsLoading && sessions.length === 0;

  return (
    <>
      <SettingsCard id="this-device">
        <SettingsRow
          id="current-session"
          layout="block"
          hideLabel
          footer={sessionError ? <RowError>{sessionError}</RowError> : null}
        >
          {() =>
            loadingFirst ? (
              <p
                role="status"
                className="flex items-center gap-2 text-ui-sm text-rm-text-secondary"
              >
                <Icon name="loader" size="sm" className="animate-spin" />
                Loading sessions…
              </p>
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
                  {sessionError
                    ? "Couldn't load your sessions."
                    : "We couldn't find this device's session."}
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
            loadingFirst ? null : otherSessions.length > 0 ? (
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
