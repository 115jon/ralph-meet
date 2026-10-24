import { useMounted } from "@/hooks/useMounted";
import { useVoiceStats } from "@/hooks/useVoiceStats";
import { clog } from "@/lib/console-logger";
import type { SFUClient, VoiceConnectionStats } from "@/lib/sfu-client";
import { buildVoiceDiagnosticsBundle } from "@/lib/voice/diagnostics";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { ResponsivePopover } from "@/components/ui/popover";
import { HIT } from "@/components/ui/interaction";
import { cn } from "@/lib/utils";
import { VoiceDebugScreen } from "./VoiceDebugScreen";

const log = clog("VoiceDetails");

const AreaChart = lazy(() =>
  import("recharts").then((m) => ({ default: m.AreaChart })),
);
const Area = lazy(() => import("recharts").then((m) => ({ default: m.Area })));
const ResponsiveContainer = lazy(() =>
  import("recharts").then((m) => ({ default: m.ResponsiveContainer })),
);
const XAxis = lazy(() =>
  import("recharts").then((m) => ({ default: m.XAxis })),
);
const YAxis = lazy(() =>
  import("recharts").then((m) => ({ default: m.YAxis })),
);
const ReTooltip = lazy(() =>
  import("recharts").then((m) => ({ default: m.Tooltip })),
);
const CHART_MARGIN = { top: 4, right: 4, bottom: 0, left: 0 };
const AXIS_TICK_STYLE = { fontSize: 9, fill: "var(--rm-text-muted)" };
const TOOLTIP_CONTENT_STYLE = {
  backgroundColor: "var(--rm-bg-floating)",
  border: "1px solid var(--rm-border)",
  borderRadius: "8px",
  fontSize: "11px",
  fontWeight: 600,
  color: "var(--rm-text)",
  padding: "4px 8px",
};
const TOOLTIP_LABEL_STYLE = { color: "var(--rm-text-muted)", fontSize: "10px" };
const LIVE_CONNECTION_POLL_MS = 1000;

interface VoiceDetailsPanelProps {
  sfu: SFUClient | null;
  isOpen: boolean;
  onClose: () => void;
  /** The control that toggles the panel; the popover anchors to it. */
  triggerRef?: React.RefObject<HTMLElement | null>;
  channelName?: string;
}

type TabId = "connection" | "privacy";

function formatConnectionStateLabel(state: string) {
  return state
    .replace(/-/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getLiveConnectionSnapshot(sfu: SFUClient | null) {
  return {
    connectionState: sfu?.getConnectionState() ?? "disconnected",
    publishConnectionState: sfu?.getPublishConnectionState() ?? "idle",
    subscribeConnectionState: sfu?.getSubscribeConnectionState() ?? "idle",
  };
}

export function VoiceDetailsPanel({
  sfu,
  isOpen,
  onClose,
  triggerRef,
  channelName,
}: VoiceDetailsPanelProps) {
  const mounted = useMounted();
  const [activeTab, setActiveTab] = useState<TabId>("connection");
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [showDebugScreen, setShowDebugScreen] = useState(false);
  const [liveSnapshot, setLiveSnapshot] = useState(() =>
    getLiveConnectionSnapshot(sfu),
  );
  const stats = useVoiceStats(sfu, isOpen);
  const connectionSnapshot = stats
    ? {
        connectionState: stats.connectionState,
        publishConnectionState: stats.publishConnectionState,
        subscribeConnectionState: stats.subscribeConnectionState,
      }
    : liveSnapshot;

  useEffect(() => {
    const syncSnapshot = () => setLiveSnapshot(getLiveConnectionSnapshot(sfu));
    syncSnapshot();

    if (!isOpen || !sfu) return;

    const intervalId = window.setInterval(
      syncSnapshot,
      LIVE_CONNECTION_POLL_MS,
    );
    return () => {
      window.clearInterval(intervalId);
    };
  }, [isOpen, sfu]);

  const handleCopyStats = useCallback(async () => {
    if (!sfu) return;
    try {
      const detailed = await sfu.getDetailedStats();
      const diagnostics = buildVoiceDiagnosticsBundle({
        detailedStats: detailed,
        connectionStats: stats,
        channelName,
        locationHref: window.location.href,
        userAgent: navigator.userAgent,
      });
      await navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2));
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 2000);
    } catch (err) {
      log.error("Failed to copy stats:", err);
    }
  }, [channelName, sfu, stats]);

  const handleDebug = useCallback(() => {
    setShowDebugScreen(true);
    onClose(); // Close the small panel when opening full debug
  }, [onClose]);

  // Render VoiceDebugScreen via a portal into document.body so it is NEVER
  // a child of the sidebar container that has `transform` applied on mobile.
  // A CSS transform on an ancestor breaks `position: fixed` — the fixed
  // element would be confined to the transformed box rather than the viewport.
  const debugPortal =
    showDebugScreen && mounted
      ? createPortal(
          <VoiceDebugScreen
            sfu={sfu}
            onClose={() => setShowDebugScreen(false)}
            channelName={channelName}
          />,
          document.body,
        )
      : null;

  // Popover anchored to the trigger on desktop, bottom drawer on phones
  // (design-system 13.1). The primitive owns placement, Escape, the back
  // button, outside presses and focus return.
  const panel = (
    <ResponsivePopover
      open={isOpen}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="Voice details"
      variant="rich"
      anchor={triggerRef}
      side="top"
      align="start"
      className="p-0"
    >
      {/* Header */}
      <div className="px-4 pt-4 pb-2">
        <h3 className="text-ui-base font-semibold text-rm-text tracking-tight">
          Voice details
        </h3>
      </div>

      {/* Tabs */}
      <div className="flex px-4 gap-4 border-b border-rm-border">
        <TabButton
          id="connection"
          label="Connection"
          active={activeTab}
          onSelect={setActiveTab}
        />
        <TabButton
          id="privacy"
          label="Privacy"
          active={activeTab}
          onSelect={setActiveTab}
        />
      </div>

      {/* Tab content */}
      <div className="px-4 py-3">
        {activeTab === "connection" ? (
          <ConnectionTab
            stats={stats}
            connectionState={connectionSnapshot.connectionState}
            publishConnectionState={connectionSnapshot.publishConnectionState}
            subscribeConnectionState={
              connectionSnapshot.subscribeConnectionState
            }
          />
        ) : (
          <PrivacyTab />
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-rm-border flex items-center gap-3 text-ui-xs font-medium">
        <span className="flex items-center gap-1.5 text-rm-success">
          <LockIcon />
          End-to-end encrypted
        </span>
        <span className="flex-1" />
        {stats ? (
          <>
            <button
              type="button"
              onClick={handleDebug}
              className={cn(
                "relative flex items-center gap-1 text-rm-accent-ink outline-none pointer-fine:hover:underline",
                HIT,
              )}
            >
              Debug <ExternalLinkIcon />
            </button>
            <button
              type="button"
              onClick={handleCopyStats}
              className={cn(
                "relative flex items-center gap-1 text-rm-accent-ink outline-none pointer-fine:hover:underline",
                HIT,
              )}
            >
              {copyFeedback ? "Copied" : "Copy stats"} <ClipboardIcon />
            </button>
          </>
        ) : (
          <span className="text-rm-text-muted/70 text-ui-2xs">
            {connectionSnapshot.connectionState === "connected"
              ? "Connected · gathering live metrics…"
              : `${formatConnectionStateLabel(connectionSnapshot.connectionState)}…`}
          </span>
        )}
      </div>
    </ResponsivePopover>
  );

  return (
    <>
      {debugPortal}
      {panel}
    </>
  );
}

// ── Tab Button ──────────────────────────────────────────────────────────────

function TabButton({
  id,
  label,
  active,
  onSelect,
}: {
  id: TabId;
  label: string;
  active: TabId;
  onSelect: (id: TabId) => void;
}) {
  const isActive = active === id;
  return (
    <button
      type="button"
      onClick={() => onSelect(id)}
      aria-pressed={isActive}
      className={cn(
        "relative border-b-2 pb-2 text-ui-sm outline-none transition-colors",
        HIT,
        isActive
          ? "border-rm-text font-semibold text-rm-text"
          : "border-transparent font-medium text-rm-text-muted pointer-fine:hover:text-rm-text",
      )}
    >
      {label}
    </button>
  );
}

// ── Connection Tab ──────────────────────────────────────────────────────────

function ConnectionTab({
  stats,
  connectionState,
  publishConnectionState,
  subscribeConnectionState,
}: {
  stats: VoiceConnectionStats | null;
  connectionState: string;
  publishConnectionState: string;
  subscribeConnectionState: string;
}) {
  const summaryCards = [
    { label: "Session", value: formatConnectionStateLabel(connectionState) },
    {
      label: "Publish",
      value: formatConnectionStateLabel(publishConnectionState),
    },
    {
      label: "Receive",
      value: formatConnectionStateLabel(subscribeConnectionState),
    },
  ];

  const chartData =
    stats && stats.pingHistory.length > 0
      ? stats.pingHistory
      : [{ time: "now", ping: 0 }];

  const maxPing = Math.max(...chartData.map((d) => d.ping), 20);
  const yMax = Math.ceil(maxPing / 10) * 10;
  const yDomain = useMemo(() => [0, yMax] as const, [yMax]);
  const formatPing = useCallback(
    (value: number | string | readonly (number | string)[] | undefined) => {
      const pingValue = Array.isArray(value) ? (value[0] ?? 0) : (value ?? 0);
      return [`${pingValue} ms`, "Ping"] as const;
    },
    [],
  );

  if (!stats) {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-2">
          {summaryCards.map((card) => (
            <div
              key={card.label}
              className="rounded-lg border border-rm-border bg-rm-bg-surface/70 px-3 py-2"
            >
              <p className="text-ui-2xs font-semibold uppercase tracking-[0.08em] text-rm-text-muted/70">
                {card.label}
              </p>
              <p className="mt-1 text-ui-xs font-semibold text-rm-text">
                {card.value}
              </p>
            </div>
          ))}
        </div>
        <div className="rounded-lg border border-rm-border bg-rm-bg-surface/50 px-3 py-4 text-center text-ui-xs text-rm-text-muted">
          {connectionState === "connected"
            ? "Connected to voice. Gathering latency and packet metrics…"
            : "Connecting to the voice transport…"}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        {summaryCards.map((card) => (
          <div
            key={card.label}
            className="rounded-lg border border-rm-border bg-rm-bg-surface/70 px-3 py-2"
          >
            <p className="text-ui-2xs font-semibold uppercase tracking-[0.08em] text-rm-text-muted/70">
              {card.label}
            </p>
            <p className="mt-1 text-ui-xs font-semibold text-rm-text">
              {card.value}
            </p>
          </div>
        ))}
      </div>

      {/* Ping Chart */}
      <div className="bg-rm-bg-surface rounded-lg p-2 border border-rm-border">
        <Suspense
          fallback={
            <div className="h-[80px] w-full flex items-center justify-center text-ui-2xs text-rm-text-muted">
              Loading chart...
            </div>
          }
        >
          <ResponsiveContainer width="100%" height={80}>
            <AreaChart data={chartData} margin={CHART_MARGIN}>
              <defs>
                <linearGradient id="pingGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="0%"
                    stopColor="var(--rm-success)"
                    stopOpacity={0.3}
                  />
                  <stop
                    offset="100%"
                    stopColor="var(--rm-success)"
                    stopOpacity={0.02}
                  />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="time"
                tick={AXIS_TICK_STYLE}
                axisLine={false}
                tickLine={false}
                interval="preserveStartEnd"
                minTickGap={60}
              />
              <YAxis
                domain={yDomain}
                tick={AXIS_TICK_STYLE}
                axisLine={false}
                tickLine={false}
                width={28}
                tickCount={3}
              />
              <ReTooltip
                contentStyle={TOOLTIP_CONTENT_STYLE}
                formatter={formatPing}
                labelStyle={TOOLTIP_LABEL_STYLE}
              />
              <Area
                type="monotone"
                dataKey="ping"
                stroke="var(--rm-success)"
                strokeWidth={1.5}
                fill="url(#pingGradient)"
                dot={false}
                activeDot={{
                  r: 3,
                  fill: "var(--rm-success)",
                  stroke: "var(--rm-success)",
                }}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </Suspense>
      </div>

      {/* Server + Stats */}
      <div className="space-y-1.5">
        <p className="text-ui-xs font-mono text-rm-text-muted tracking-tight">
          {stats.serverIdentifier}
        </p>
        <div className="text-ui-sm text-rm-text space-y-0.5">
          <p>
            <span className="font-semibold">Average ping:</span>{" "}
            <span className="font-bold text-rm-text">{stats.avgPing} ms</span>
          </p>
          <p>
            <span className="font-semibold">Last ping:</span>{" "}
            <span className="font-bold text-rm-text">{stats.ping} ms</span>
          </p>
          <p>
            <span className="font-semibold">Outbound packet loss rate:</span>{" "}
            <span className="font-bold text-rm-text">
              {(stats.packetLossRate * 100).toFixed(1)}%
            </span>
          </p>
          <p>
            <span className="font-semibold">Remote tracks:</span>{" "}
            <span className="font-bold text-rm-text">
              {stats.remoteTrackCount}
            </span>
          </p>
        </div>
      </div>

      {/* Info Blurb */}
      <div className="text-ui-2xs text-rm-text-muted leading-relaxed bg-rm-bg-surface/50 rounded-lg p-2.5 border border-rm-border">
        You may notice delayed audio at 250 ms or higher. You may sound robotic
        if your packet loss rate is over 10%. If the problem persists,
        disconnect and try again.
      </div>
    </div>
  );
}

// ── Privacy Tab ─────────────────────────────────────────────────────────────

function PrivacyTab() {
  return (
    <div className="py-4 space-y-3">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-rm-success/10 flex items-center justify-center">
          <LockIcon className="text-rm-success" size={20} />
        </div>
        <div>
          <p className="text-ui-sm font-semibold text-rm-text">
            End-to-End Encrypted
          </p>
          <p className="text-ui-xs text-rm-text-muted">
            Your voice connection is secured with DTLS-SRTP encryption.
          </p>
        </div>
      </div>
      <div className="text-ui-2xs text-rm-text-muted leading-relaxed bg-rm-bg-surface/50 rounded-lg p-2.5 border border-rm-border">
        Audio and video data is encrypted in transit using DTLS-SRTP. Only
        participants in this voice channel can hear or see your media.
      </div>
    </div>
  );
}

// ── Inline SVG Icons ────────────────────────────────────────────────────────

function LockIcon({
  className = "",
  size = 14,
}: {
  className?: string;
  size?: number;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function ExternalLinkIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={12}
      height={12}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15,3 21,3 21,9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

function ClipboardIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={12}
      height={12}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect width="8" height="4" x="8" y="2" rx="1" ry="1" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
    </svg>
  );
}
