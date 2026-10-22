import { IconButton } from "@/components/ui/IconButton";
import { apiDelete, apiGet } from "@/lib/api-client";
import { useClientReferenceTime } from "@/lib/client-date-format";
import { Icon } from "@/components/ui/icon";
import { useCallback, useEffect, useState } from "react";

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

function useDevicesState() {
  const [sessions, setSessions] = useState<any[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);

  return {
    sessions,
    setSessions,
    sessionsLoading,
    setSessionsLoading,
    sessionError,
    setSessionError,
  };
}

function DeviceRow({
  session,
  onRevoke,
  now,
}: {
  session: any;
  onRevoke: (id: string) => void;
  now: number | null;
}) {
  const deviceIcon = session.activity?.isMobile ? "mobile" : "monitor";

  const browserName =
    session.activity?.browserName ||
    (session.activity?.isMobile ? "Mobile Client" : "Desktop Client");
  const deviceType =
    session.activity?.deviceType ||
    (session.activity?.isMobile ? "Mobile" : "Desktop");
  const title = `${deviceType} · ${browserName}`.toUpperCase();

  const location =
    [session.activity?.city, session.activity?.country]
      .filter(Boolean)
      .join(", ") || "Unknown Location";

  let timeAgo = "Unknown time";
  const lastActiveAt = normalizeTimestamp(session.lastActiveAt);
  if (lastActiveAt !== null && now !== null) {
    const minDiff = Math.floor((now - lastActiveAt) / 60000);
    if (minDiff < 1) timeAgo = "less than a minute ago";
    else if (minDiff < 60) timeAgo = `less than an hour ago`;
    else if (minDiff < 1440)
      timeAgo = `${Math.floor(minDiff / 60)} hour${Math.floor(minDiff / 60) === 1 ? "" : "s"} ago`;
    else
      timeAgo = `${Math.floor(minDiff / 1440)} day${Math.floor(minDiff / 1440) === 1 ? "" : "s"} ago`;
  }

  return (
    <div className="group flex flex-col sm:flex-row sm:items-center justify-between p-4 px-5 gap-4">
      <div className="flex items-center gap-4 min-w-0">
        <div className="w-[42px] h-[42px] rounded-full border border-rm-border flex items-center justify-center bg-rm-bg-elevated text-rm-text shrink-0">
          <Icon name={deviceIcon} size="xl" />
        </div>
        <div className="flex-1 min-w-0 flex flex-col gap-0.5">
          <h4 className="text-ui-sm font-bold text-rm-text truncate">
            {title}
          </h4>
          <p className="text-ui-sm text-rm-text-muted truncate">
            {location}
            {!session.isCurrent && ` · ${timeAgo}`}
          </p>
        </div>
      </div>
      {!session.isCurrent && (
        <IconButton
          aria-label="Revoke session"
          icon="close"
          variant="destructive"
          size="sm"
          shape="circle"
          className="shrink-0 self-end sm:self-auto"
          onClick={() => onRevoke(session.id)}
        />
      )}
    </div>
  );
}

export default function SettingsDevicesTab() {
  const {
    sessions,
    setSessions,
    sessionsLoading,
    setSessionsLoading,
    sessionError,
    setSessionError,
  } = useDevicesState();
  const referenceTime = useClientReferenceTime();

  const fetchSessions = useCallback(async () => {
    setSessionsLoading(true);
    setSessionError(null);
    try {
      const data = await apiGet<{ sessions: any[] }>("/api/sessions");
      setSessions(data.sessions);
    } catch (err: any) {
      setSessionError(err.message || "Failed to load sessions");
    } finally {
      setSessionsLoading(false);
    }
  }, [setSessionsLoading, setSessionError, setSessions]);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const handleRevokeSession = async (sessionId: string) => {
    try {
      await apiDelete("/api/sessions", { sessionId });
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    } catch (err: any) {
      setSessionError(err.message || "Failed to revoke session");
    }
  };

  const currentSessions = sessions.filter((session) => session.isCurrent);
  const otherSessions = sessions.filter((session) => !session.isCurrent);

  return (
    <div className="animate-in fade-in duration-150">
      <h1 className="text-2xl font-bold text-rm-text mb-2 hidden md:block">
        Devices
      </h1>
      <p className="text-sm text-rm-text-muted mb-8 leading-relaxed">
        Here are all the devices that are currently logged in with your Ralph
        Meet account. You can log out of each one individually or all other
        devices.
        <br />
        <br />
        If you see an entry you don't recognize, log out of that device and
        change your account password immediately.
      </p>

      {sessionError && (
        <div className="rounded-xl bg-rm-danger-tint px-4 py-3 text-sm text-rm-danger-ink font-medium mb-6">
          {sessionError}
        </div>
      )}

      {sessionsLoading && !sessions.length ? (
        <div className="flex flex-col items-center justify-center py-12">
          <Icon
            name="loader"
            size="2xl"
            className="animate-spin text-rm-text-muted mb-4"
          />
          <p className="text-rm-text-muted font-medium">Loading devices...</p>
        </div>
      ) : (
        <div className="space-y-8">
          {currentSessions.length > 0 && (
            <section>
              <h3 className="text-ui-xs font-medium text-rm-text-muted mb-4">
                Current Device
              </h3>
              <div className="bg-rm-bg-surface border border-rm-border rounded-xl flex flex-col divide-y divide-rm-border">
                {currentSessions.map((s) => (
                  <DeviceRow
                    key={s.id}
                    session={s}
                    onRevoke={handleRevokeSession}
                    now={referenceTime}
                  />
                ))}
              </div>
            </section>
          )}

          {otherSessions.length > 0 && (
            <section>
              <h3 className="text-ui-xs font-medium text-rm-text-muted mb-4">
                Other Devices
              </h3>
              <div className="bg-rm-bg-surface border border-rm-border rounded-xl flex flex-col divide-y divide-rm-border">
                {otherSessions.map((s) => (
                  <DeviceRow
                    key={s.id}
                    session={s}
                    onRevoke={handleRevokeSession}
                    now={referenceTime}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
