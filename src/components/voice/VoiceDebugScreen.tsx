import { clog } from "@/lib/console-logger";
import type { SFUClient, VoiceConnectionStats } from "@/lib/sfu-client";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

const log = clog("VoiceDebug");

const AreaChart = lazy(() => import("recharts").then(m => ({ default: m.AreaChart })));
const Area = lazy(() => import("recharts").then(m => ({ default: m.Area })));
const ResponsiveContainer = lazy(() => import("recharts").then(m => ({ default: m.ResponsiveContainer })));
const XAxis = lazy(() => import("recharts").then(m => ({ default: m.XAxis })));
const YAxis = lazy(() => import("recharts").then(m => ({ default: m.YAxis })));
const CHART_MARGIN = { top: 4, right: 4, bottom: 0, left: 0 };
const AXIS_TICK_STYLE = { fontSize: 9, fill: "var(--rm-text-muted)" };

interface VoiceDebugScreenProps {
  sfu: SFUClient | null;
  onClose: () => void;
  channelName?: string;
}

type SidebarSection = "transport" | "outbound" | string; // string = inbound track name

interface DebugData {
  connectionState: string;
  participantId: string | null;
  roomSlug: string;
  transportHistory: { time: string; availableOutgoingBitrate: number; ping: number; outboundBitrate: number; inboundBitrate: number; packetsReceived: number; packetsSent: number; bytesReceived: number; bytesSent: number }[];
  inboundHistory: Record<string, { time: string; bitrate: number; packetsReceived: number; packetsLost: number; jitter: number }[]>;
  connStats: VoiceConnectionStats | null;
  pulledTracks: { track_name: string; participant_id: string; kind: string }[];
}

const formatBytes = (b: number) => {
  if (b >= 1e9) return `${(b / 1e9).toFixed(2)} GB`;
  if (b >= 1e6) return `${(b / 1e6).toFixed(2)} MB`;
  if (b >= 1e3) return `${(b / 1e3).toFixed(2)} KB`;
  return `${b} B`;
};

const formatKbps = (v: number) => `${Math.max(0, v / 1000).toFixed(2)} Kbps`;

export function VoiceDebugScreen({ sfu, onClose, channelName = "Voice" }: VoiceDebugScreenProps) {
  const [section, setSection] = useState<SidebarSection>("transport");
  const [data, setData] = useState<DebugData | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!sfu) return;
    const update = () => setData(sfu.getDebugData());
    update();
    intervalRef.current = setInterval(update, 2000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [sfu]);

  // Close on escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleCopyStats = useCallback(async () => {
    if (!sfu) return;
    try {
      const detailed = await sfu.getDetailedStats();
      await navigator.clipboard.writeText(JSON.stringify(detailed, null, 2));
      const btn = document.getElementById("copy-stats-btn");
      if (btn) {
        const originalText = btn.innerText;
        btn.innerText = "✓ Copied";
        btn.classList.add("text-[#23a559]", "bg-[#23a559]/10");
        setTimeout(() => {
          btn.innerText = originalText;
          btn.classList.remove("text-[#23a559]", "bg-[#23a559]/10");
        }, 2000);
      }
    } catch (err) {
      log.error("Failed to copy stats:", err);
    }
  }, [sfu]);

  if (!data) {
    return (
      <div className="fixed inset-0 z-[9999] bg-[#111214] flex flex-col items-center justify-center gap-4">
        <div className="w-8 h-8 border-4 border-rm-accent/30 border-t-rm-accent rounded-full animate-spin" />
        <p className="text-rm-text-muted text-[13px] font-medium animate-pulse">Gathering RTC metrics…</p>
      </div>
    );
  }

  const connState = data.connectionState;
  const isConnected = connState === "connected";
  const inboundTrackNames = Object.keys(data.inboundHistory);

  return (
    <div className="fixed inset-0 z-[9999] bg-rm-bg-primary flex flex-col text-rm-text text-[13px] overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center justify-between px-3 sm:px-5 py-2.5 sm:py-3 border-b border-rm-border bg-rm-bg-surface gap-2">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full bg-rm-status-online animate-pulse shrink-0" />
          <span className="font-bold text-[13px] sm:text-[15px] text-rm-text tracking-tight truncate">RTC DEBUG: {data.roomSlug}</span>
        </div>
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <button
            id="copy-stats-btn"
            onClick={handleCopyStats}
            className="px-2.5 sm:px-3 py-1.5 text-[11px] sm:text-[12px] font-semibold rounded-md border border-rm-border bg-rm-bg-surface hover:bg-rm-bg-hover text-rm-text-primary transition-all min-w-[80px]"
          >
            Copy Stats
          </button>
          <button
            onClick={onClose}
            className="px-2.5 sm:px-3 py-1.5 text-[11px] sm:text-[12px] font-semibold rounded-md bg-rm-status-dnd/10 hover:bg-rm-status-dnd/20 text-rm-status-dnd transition-colors"
          >
            ✕ Close
          </button>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row flex-1 overflow-hidden">
        {/* Sidebar — vertical on desktop, horizontal scrollable tabs on mobile */}
        <div className="sm:w-52 shrink-0 sm:border-r border-b sm:border-b-0 border-rm-border bg-rm-bg-surface sm:p-4 sm:space-y-4 sm:overflow-y-auto">
          {/* Mobile: horizontal strip */}
          <div className="flex sm:hidden items-center gap-2 px-3 py-2 overflow-x-auto scrollbar-none">
            <span className="text-[12px] font-bold text-rm-text shrink-0">{channelName}</span>
            <span className={`text-[10px] font-semibold shrink-0 ${isConnected ? "text-rm-status-online" : "text-rm-status-idle"}`}>
              {isConnected ? "●" : "○"}
            </span>
            <div className="w-px h-4 bg-rm-border mx-1" />
            <SidebarItem id="transport" label="Transport" active={section} onSelect={setSection} />
            <SidebarItem id="outbound" label="Outbound" active={section} onSelect={setSection} />
            {inboundTrackNames.map(name => {
              const shortName = name.replace(/^(cam|screen)-(audio|video)-/, "").slice(0, 10);
              const kind = name.includes("audio") ? "🔊" : name.includes("video") ? "📹" : "⬇";
              return <SidebarItem key={name} id={name} label={`${kind} ${shortName}`} active={section} onSelect={setSection} />;
            })}
          </div>

          {/* Desktop: vertical sidebar */}
          <div className="hidden sm:block space-y-4">
            <div className="space-y-1">
              <span className="text-[14px] font-bold text-rm-text">{channelName}</span>
              <p className={`text-[11px] font-semibold ${isConnected ? "text-rm-status-online" : "text-rm-status-idle"}`}>
                {isConnected ? "Connected" : connState}
              </p>
            </div>

            <div className="space-y-0.5">
              <p className="text-[10px] font-bold text-rm-text-muted uppercase tracking-wider mb-1">RTC Debug: Default</p>
              <SidebarItem id="transport" label="Transport" active={section} onSelect={setSection} />
              <SidebarItem id="outbound" label="Outbound" active={section} onSelect={setSection} />
            </div>

            {inboundTrackNames.length > 0 && (
              <div className="space-y-0.5">
                <p className="text-[10px] font-bold text-rm-text-muted uppercase tracking-wider mb-1">Inbound</p>
                {inboundTrackNames.map(name => {
                  const shortName = name.replace(/^(cam|screen)-(audio|video)-/, "").slice(0, 12);
                  const kind = name.includes("audio") ? "🔊" : name.includes("video") ? "📹" : "⬇";
                  return (
                    <SidebarItem key={name} id={name} label={`${kind} ${shortName}`} active={section} onSelect={setSection} />
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Main content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5 sm:space-y-6">
          {section === "transport" && <TransportSection data={data} />}
          {section === "outbound" && <OutboundSection data={data} />}
          {section !== "transport" && section !== "outbound" && (
            <InboundSection trackName={section} data={data} />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Sidebar Item ────────────────────────────────────────────────────────

function SidebarItem({ id, label, active, onSelect }: {
  id: string;
  label: string;
  active: string;
  onSelect: (id: string) => void;
}) {
  const isActive = active === id;
  return (
    <button
      onClick={() => onSelect(id)}
      className={`sm:w-full text-left px-2.5 sm:px-2 py-1 rounded text-[12px] font-medium transition-colors whitespace-nowrap shrink-0 ${isActive
        ? "bg-rm-bg-active text-rm-text"
        : "text-rm-text-muted hover:bg-rm-bg-hover hover:text-rm-text"
        }`}
    >
      {label}
    </button>
  );
}

// ── Mini Chart Component ────────────────────────────────────────────────

function MiniChart({ data, dataKey, color = "var(--rm-accent)", unit = "", height = 80 }: {
  data: any[];
  dataKey: string;
  color?: string;
  unit?: string;
  height?: number;
}) {
  if (!data || data.length === 0) {
    return <div className="h-20 flex items-center justify-center text-[11px] text-rm-text-muted">No data</div>;
  }

  // If plotting a bitrate, divide raw value by 1000 so the chart plots Kbps
  const isBitrate = dataKey.toLowerCase().includes("bitrate");
  const processedData = data.map(d => ({
    ...d,
    [dataKey]: isBitrate ? Math.max(0, (d[dataKey] ?? 0) / 1000) : (d[dataKey] ?? 0)
  }));
  const maxVal = Math.max(...processedData.map(d => d[dataKey]), 1);
  const yMax = Math.ceil(maxVal * 1.2);
  const yDomain = useMemo(() => [0, yMax] as const, [yMax]);
  const formatTick = useCallback((value: number) => `${value}${unit}`, [unit]);

  return (
    <Suspense fallback={<div className="h-20 w-full flex items-center justify-center text-[10px] text-rm-text-muted">Loading chart...</div>}>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={processedData} margin={CHART_MARGIN}>
          <defs>
            <linearGradient id={`grad-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.25} />
              <stop offset="100%" stopColor={color} stopOpacity={0.02} />
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
            width={42}
            tickCount={3}
            tickFormatter={formatTick}
          />
          <Area
            type="monotone" // smooth curve instead of harsh straight lines
            dataKey={dataKey}
            stroke={color}
            strokeWidth={1.5}
            fill={`url(#grad-${dataKey})`}
            dot={false}
            activeDot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </Suspense>
  );
}

// ── Stat Row ────────────────────────────────────────────────────────────

function StatRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-rm-border">
      <span className="text-rm-text-muted text-[13px]">{label}</span>
      <span className="text-rm-text font-semibold tabular-nums text-[13px]">{value}</span>
    </div>
  );
}

// ── Chart Card ──────────────────────────────────────────────────────────

function ChartCard({ title, value, data, dataKey, color, unit }: {
  title: string;
  value: string;
  data: any[];
  dataKey: string;
  color?: string;
  unit?: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between">
        <span className="text-[13px] font-semibold text-rm-text">{title}</span>
        <span className="text-[13px] font-semibold text-rm-text tabular-nums">{value}</span>
      </div>
      <div className="bg-rm-bg-surface rounded-lg p-3 border border-rm-border shadow-sm">
        <MiniChart data={data} dataKey={dataKey} color={color} unit={unit} />
      </div>
    </div>
  );
}

// ── Transport Section ───────────────────────────────────────────────────

function TransportSection({ data }: { data: DebugData }) {
  const stats = data.connStats;
  const history = data.transportHistory;
  const latest = history[history.length - 1];

  return (
    <div className="space-y-5">
      <h2 className="text-[14px] font-bold text-rm-status-idle border-b border-rm-border pb-2">
        Transport · {data.participantId || "unknown"}
      </h2>

      {/* Row 1: Available Outgoing Bitrate + Ping */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <ChartCard
          title="Available Outgoing Bitrate"
          value={formatKbps(latest?.availableOutgoingBitrate ?? 0)}
          data={history}
          dataKey="availableOutgoingBitrate"
          color="var(--rm-accent)"
          unit=""
        />
        <ChartCard
          title="Ping"
          value={`${latest?.ping ?? 0} ms`}
          data={history}
          dataKey="ping"
          color="var(--rm-status-online)"
          unit=""
        />
      </div>

      {/* Static stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <StatRow label="Local Address" value={stats?.localAddress || "(unknown)"} />
        <StatRow label="Remote Address" value={stats?.remoteAddress || "(unknown)"} />
      </div>

      {/* Row 2: Outbound + Inbound Bitrate Estimate */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <ChartCard
          title="Outbound Bitrate Estimate"
          value={formatKbps(latest?.outboundBitrate ?? 0)}
          data={history}
          dataKey="outboundBitrate"
          color="var(--color-chart-4)"
          unit=""
        />
        <ChartCard
          title="Inbound Bitrate Estimate"
          value={formatKbps(latest?.inboundBitrate ?? 0)}
          data={history}
          dataKey="inboundBitrate"
          color="var(--rm-status-idle)"
          unit=""
        />
      </div>

      {/* Row 3: Packets Received + Packets Sent */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <ChartCard
          title="Packets Received"
          value={(latest?.packetsReceived ?? 0).toLocaleString()}
          data={history}
          dataKey="packetsReceived"
          color="var(--color-chart-2)"
          unit=""
        />
        <ChartCard
          title="Packets Sent"
          value={(latest?.packetsSent ?? 0).toLocaleString()}
          data={history}
          dataKey="packetsSent"
          color="var(--rm-accent)"
          unit=""
        />
      </div>

      {/* Row 4: Bytes */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <ChartCard
          title="Bytes Received"
          value={formatBytes(latest?.bytesReceived ?? 0)}
          data={history}
          dataKey="bytesReceived"
          color="var(--color-chart-2)"
          unit=""
        />
        <ChartCard
          title="Bytes Sent"
          value={formatBytes(latest?.bytesSent ?? 0)}
          data={history}
          dataKey="bytesSent"
          color="var(--rm-accent)"
          unit=""
        />
      </div>

      {/* Additional stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <StatRow label="Codec" value={stats?.codec ? `${stats.codec.name} (${stats.codec.id})` : "N/A"} />
        <StatRow label="Sample Rate" value={`${stats?.sampleRate ?? 0} Hz`} />
        <StatRow label="Packet Loss Rate" value={`${((stats?.packetLossRate ?? 0) * 100).toFixed(2)}%`} />
        <StatRow label="Connection State" value={data.connectionState} />
      </div>
    </div>
  );
}

// ── Outbound Section ────────────────────────────────────────────────────

function OutboundSection({ data }: { data: DebugData }) {
  const stats = data.connStats;
  const history = data.transportHistory;
  const latest = history[history.length - 1];

  return (
    <div className="space-y-5">
      <h2 className="text-[14px] font-bold text-rm-status-idle border-b border-rm-border pb-2">
        Outbound
      </h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <ChartCard
          title="Outbound Bitrate"
          value={formatKbps(latest?.outboundBitrate ?? 0)}
          data={history}
          dataKey="outboundBitrate"
          color="var(--color-chart-4)"
          unit=""
        />
        <ChartCard
          title="Packets Sent"
          value={(latest?.packetsSent ?? 0).toLocaleString()}
          data={history}
          dataKey="packetsSent"
          color="var(--rm-accent)"
          unit=""
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <StatRow label="Codec" value={stats?.codec ? `${stats.codec.name} (${stats.codec.id})` : "N/A"} />
        <StatRow label="Frames Encoded" value={(stats?.framesEncoded ?? 0).toLocaleString()} />
        <StatRow label="Sample Rate" value={`${stats?.sampleRate ?? 0} Hz`} />
        <StatRow label="Audio Level" value={(stats?.audioLevel ?? 0).toFixed(4)} />
      </div>
    </div>
  );
}

// ── Inbound Section (per-track) ─────────────────────────────────────────

function InboundSection({ trackName, data }: { trackName: string; data: DebugData }) {
  const history = data.inboundHistory[trackName] || [];
  const latest = history[history.length - 1];
  const track = data.pulledTracks.find(t => t.track_name === trackName);

  return (
    <div className="space-y-5">
      <h2 className="text-[14px] font-bold text-rm-status-idle border-b border-rm-border pb-2">
        Inbound · {trackName}
      </h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <StatRow label="Participant ID" value={track?.participant_id || "unknown"} />
        <StatRow label="Kind" value={track?.kind || "unknown"} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <ChartCard
          title="Bitrate"
          value={formatKbps(latest?.bitrate ?? 0)}
          data={history}
          dataKey="bitrate"
          color="var(--color-chart-2)"
          unit=""
        />
        <ChartCard
          title="Packets Received"
          value={(latest?.packetsReceived ?? 0).toLocaleString()}
          data={history}
          dataKey="packetsReceived"
          color="var(--rm-accent)"
          unit=""
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <StatRow label="Packets Lost" value={(latest?.packetsLost ?? 0).toLocaleString()} />
        <StatRow label="Jitter" value={`${((latest?.jitter ?? 0) * 1000).toFixed(2)} ms`} />
      </div>
    </div>
  );
}
