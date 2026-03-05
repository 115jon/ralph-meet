import { apiDelete, apiGet } from "@/lib/api-client";
import { Loader2, Monitor, Smartphone, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

function useDevicesState() {
  const [sessions, setSessions] = useState<any[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);

  return {
    sessions, setSessions,
    sessionsLoading, setSessionsLoading,
    sessionError, setSessionError
  };
}

function DeviceRow({ session, onRevoke, now }: { session: any, onRevoke: (id: string) => void, now: number }) {
  const Icon = session.activity?.isMobile ? Smartphone : Monitor;

  const browserName = session.activity?.browserName || (session.activity?.isMobile ? "Mobile Client" : "Desktop Client");
  const deviceType = session.activity?.deviceType || (session.activity?.isMobile ? "Mobile" : "Desktop");
  const title = `${deviceType} · ${browserName}`.toUpperCase();

  const location = [session.activity?.city, session.activity?.country].filter(Boolean).join(", ") || "Unknown Location";

  let timeAgo = "Unknown time";
  if (session.lastActiveAt) {
    const minDiff = Math.floor((now - session.lastActiveAt) / 60000);
    if (minDiff < 1) timeAgo = "less than a minute ago";
    else if (minDiff < 60) timeAgo = `less than an hour ago`;
    else if (minDiff < 1440) timeAgo = `${Math.floor(minDiff / 60)} hour${Math.floor(minDiff / 60) === 1 ? '' : 's'} ago`;
    else timeAgo = `${Math.floor(minDiff / 1440)} day${Math.floor(minDiff / 1440) === 1 ? '' : 's'} ago`;
  }

  return (
    <div className="group flex flex-col sm:flex-row sm:items-center justify-between p-4 px-5 hover:bg-rm-bg-elevated/40 transition-all gap-4">
      <div className="flex items-center gap-4 min-w-0">
        <div className="w-[42px] h-[42px] rounded-full border border-rm-border flex items-center justify-center bg-rm-bg-elevated text-rm-text shrink-0">
          <Icon size={22} />
        </div>
        <div className="flex-1 min-w-0 flex flex-col gap-0.5">
          <h4 className="text-[13px] font-bold text-rm-text truncate">{title}</h4>
          <p className="text-[13px] text-rm-text-muted truncate">
            {location}{!session.isCurrent && ` · ${timeAgo}`}
          </p>
        </div>
      </div>
      {!session.isCurrent && (
        <button
          onClick={() => onRevoke(session.id)}
          className="flex items-center justify-center w-8 h-8 rounded-full text-rm-text-muted hover:bg-destructive/10 hover:text-destructive transition-all shrink-0 self-end sm:self-auto"
        >
          <X size={20} />
        </button>
      )}
    </div>
  );
}

export default function SettingsDevicesTab() {
  const {
    sessions, setSessions,
    sessionsLoading, setSessionsLoading,
    sessionError, setSessionError
  } = useDevicesState();

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

  return (
    <div className="animate-in fade-in slide-in-from-right-4 duration-300">
      <h1 className="text-2xl font-bold text-rm-text mb-2 hidden md:block">
        Devices
      </h1>
      <p className="text-sm text-rm-text-muted mb-8 leading-relaxed">
        Here are all the devices that are currently logged in with your Ralph Meet account. You can log out of each one individually or all other devices.
        <br /><br />
        If you see an entry you don't recognize, log out of that device and change your account password immediately.
      </p>

      {sessionError && (
        <div className="rounded-lg bg-destructive/10 border border-destructive/30 px-4 py-3 text-sm text-destructive font-medium mb-6">
          {sessionError}
        </div>
      )}

      {sessionsLoading && !sessions.length ? (
        <div className="flex flex-col items-center justify-center py-12">
          <Loader2 size={32} className="animate-spin text-rm-text-muted mb-4" />
          <p className="text-rm-text-muted font-medium">Loading devices...</p>
        </div>
      ) : (
        <div className="space-y-8">
          {sessions.some(s => s.isCurrent) && (
            <section>
              <h3 className="text-[12px] font-bold uppercase tracking-wider text-rm-text-muted mb-4">
                Current Device
              </h3>
              <div className="bg-rm-bg-surface border border-rm-border rounded-xl flex flex-col divide-y divide-rm-border">
                {sessions.filter(s => s.isCurrent).map(s => (
                  <DeviceRow key={s.id} session={s} onRevoke={handleRevokeSession} now={Date.now()} />
                ))}
              </div>
            </section>
          )}

          {sessions.some(s => !s.isCurrent) && (
            <section>
              <h3 className="text-[12px] font-bold uppercase tracking-wider text-rm-text-muted mb-4">
                Other Devices
              </h3>
              <div className="bg-rm-bg-surface border border-rm-border rounded-xl flex flex-col divide-y divide-rm-border">
                {sessions.filter(s => !s.isCurrent).map(s => (
                  <DeviceRow key={s.id} session={s} onRevoke={handleRevokeSession} now={Date.now()} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
