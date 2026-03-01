
import { apiGet } from '@/lib/api-client';
import type { ServerAuditLog } from '@/lib/types';
import { useEffect, useState } from 'react';
import { Loader2 } from './Icons';

interface AuditLogTabProps {
  serverId: string;
}

export default function AuditLogTab({ serverId }: AuditLogTabProps) {
  const [logs, setLogs] = useState<ServerAuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function fetchLogs() {
      try {
        setLoading(true);
        setError(null);
        const data = await apiGet<ServerAuditLog[]>(`/api/servers/${serverId}/audit-logs`);

        if (mounted) {
          setLogs(data);
        }
      } catch (err: any) {
        if (mounted) setError(err.message || 'An error occurred');
      } finally {
        if (mounted) setLoading(false);
      }
    }

    fetchLogs();
    return () => { mounted = false; };
  }, [serverId]);

  const formatActionType = (type: string) => {
    return type.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ');
  };

  const formatChanges = (changes: any) => {
    if (!changes) return null;

    return Object.entries(changes).map(([key, value]) => {
      let displayValue = String(value);
      if (typeof value === 'object') {
        displayValue = JSON.stringify(value);
      }
      if (value === null || value === undefined || value === '') {
        displayValue = 'None / Removed';
      }

      return (
        <div key={key} className="text-xs text-rm-text-muted mt-1 flex gap-2">
          <span className="font-semibold text-rm-text-secondary">{key}:</span>
          <span className="truncate max-w-[200px]" title={displayValue}>{displayValue}</span>
        </div>
      );
    });
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-rm-text-muted">
        <Loader2 className="h-8 w-8 animate-spin mb-4" />
        <p>Loading audit logs...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
        {error}
      </div>
    );
  }

  if (logs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-rm-text-muted text-center space-y-2">
        <div className="h-12 w-12 rounded-full bg-rm-bg-hover flex items-center justify-center mb-2">
          <span className="text-xl">📋</span>
        </div>
        <h3 className="text-rm-text font-semibold">No recent activity</h3>
        <p className="text-sm">There are no audit logs for this server yet.</p>
      </div>
    );
  }

  return (
    <div className="animate-in fade-in slide-in-from-right-4 duration-300 w-full pb-8">
      <h2 id="server-settings-title" className="mb-6 text-xl font-bold text-rm-text">
        Audit Log
      </h2>

      <p className="text-sm text-rm-text-muted mb-6">
        A record of recent administrative actions taken in this server.
      </p>

      <div className="space-y-4 max-w-2xl relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-rm-border before:to-transparent">
        {logs.map((log) => (
          <div key={log.id} className="relative flex items-start gap-4 group">
            {/* Icon/Timeline Dot */}
            <div className="flex items-center justify-center w-10 h-10 rounded-full border-4 border-rm-bg-primary bg-rm-bg-surface text-rm-text-muted shadow shrink-0 overflow-hidden relative z-10">
              {log.actor?.avatar_url ? (
                <img src={log.actor?.avatar_url} alt="Avatar" className="w-full h-full object-cover" />
              ) : (
                <span className="text-xs font-bold">{(log.actor?.username || '?')[0].toUpperCase()}</span>
              )}
            </div>

            {/* Card Content */}
            <div className="flex-1 min-w-0 rounded-xl border border-rm-border bg-rm-bg-surface p-4 shadow shadow-black/5 transition-all hover:border-primary/30">
              <div className="flex justify-between items-start mb-2">
                <div className="flex gap-2 items-center">
                  <span className="font-semibold text-sm text-rm-text">{log.actor?.username || 'Unknown User'}</span>
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-primary/10 text-primary uppercase tracking-wider">
                    {formatActionType(log.action_type)}
                  </span>
                </div>
              </div>

              <div className="text-xs text-rm-text-muted mb-3 flex items-center gap-2">
                <span>{new Date(log.created_at).toLocaleString()}</span>
                {log.target_id && (
                  <>
                    <span>•</span>
                    <span className="font-mono bg-rm-bg-hover px-1.5 py-0.5 rounded text-[10px]">Target: {log.target_id}</span>
                  </>
                )}
              </div>

              {log.reason && (
                <div className="mt-2 text-sm text-rm-text border-l-2 border-rm-border pl-3 italic">
                  "{log.reason}"
                </div>
              )}

              {log.changes && Object.keys(log.changes).length > 0 && (
                <div className="mt-3 bg-rm-bg-hover/50 rounded-lg p-3 border border-rm-border/50">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-rm-text-muted mb-1 block">Changes</span>
                  <div className="space-y-1">
                    {formatChanges(log.changes)}
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
