import { useVoiceStats } from "@/hooks/useVoiceStats";
import { clog } from "@/lib/console-logger";
import type { SFUClient, VoiceConnectionStats } from "@/lib/sfu-client";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { createPortal } from "react-dom";
import { VoiceDebugScreen } from "./VoiceDebugScreen";

const log = clog("VoiceDetails");

const AreaChart = lazy(() => import("recharts").then(m => ({ default: m.AreaChart })));
const Area = lazy(() => import("recharts").then(m => ({ default: m.Area })));
const ResponsiveContainer = lazy(() => import("recharts").then(m => ({ default: m.ResponsiveContainer })));
const XAxis = lazy(() => import("recharts").then(m => ({ default: m.XAxis })));
const YAxis = lazy(() => import("recharts").then(m => ({ default: m.YAxis })));
const ReTooltip = lazy(() => import("recharts").then(m => ({ default: m.Tooltip })));

interface VoiceDetailsPanelProps {
  isClosing?: boolean;
  sfu: SFUClient | null;
  isOpen: boolean;
  onClose: () => void;
  triggerRef?: React.RefObject<HTMLElement | null>;
  channelName?: string;
}

type TabId = "connection" | "privacy";

export function VoiceDetailsPanel({ sfu, isOpen, onClose, triggerRef, channelName, isClosing }: VoiceDetailsPanelProps) {
  const [activeTab, setActiveTab] = useState<TabId>("connection");
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [showDebugScreen, setShowDebugScreen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const stats = useVoiceStats(sfu, isOpen);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current && !panelRef.current.contains(target) &&
        (!triggerRef?.current || !triggerRef.current.contains(target))) {
        onClose();
      }
    };
    // Delay to avoid immediate close from the same click that opened it
    const timer = setTimeout(() => document.addEventListener("mousedown", handler), 50);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handler);
    };
  }, [isOpen, onClose]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  const handleCopyStats = useCallback(async () => {
    if (!sfu) return;
    try {
      const detailed = await sfu.getDetailedStats();
      await navigator.clipboard.writeText(JSON.stringify(detailed, null, 2));
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 2000);
    } catch (err) {
      log.error("Failed to copy stats:", err);
    }
  }, [sfu]);

  const handleDebug = useCallback(() => {
    setShowDebugScreen(true);
    onClose(); // Close the small panel when opening full debug
  }, [onClose]);

  // Render VoiceDebugScreen via a portal into document.body so it is NEVER
  // a child of the sidebar container that has `transform` applied on mobile.
  // A CSS transform on an ancestor breaks `position: fixed` — the fixed
  // element would be confined to the transformed box rather than the viewport.
  const debugPortal = showDebugScreen && typeof document !== "undefined"
    ? createPortal(
      <VoiceDebugScreen
        sfu={sfu}
        onClose={() => setShowDebugScreen(false)}
        channelName={channelName}
      />,
      document.body
    )
    : null;

  if (!isOpen && !debugPortal) return null;

  return (
    <>
      {debugPortal}
      {isOpen && (
        <div
          ref={panelRef}
          className={cn("absolute bottom-full left-0 mb-2 w-[320px] bg-rm-bg-floating border border-rm-border rounded-xl shadow-2xl z-[200] overflow-hidden origin-bottom-left", isClosing ? "animate-out fade-out slide-out-to-bottom-2 zoom-out-95 duration-200" : "animate-in fade-in slide-in-from-bottom-2 duration-200")}
          role="dialog"
          aria-label="Voice Details"
        >
          {/* Header */}
          <div className="px-4 pt-4 pb-2">
            <h3 className="text-[15px] font-bold text-rm-text tracking-tight">Voice Details</h3>
          </div>

          {/* Tabs */}
          <div className="flex px-4 gap-4 border-b border-rm-border">
            <TabButton id="connection" label="Connection" active={activeTab} onSelect={setActiveTab} />
            <TabButton id="privacy" label="Privacy" active={activeTab} onSelect={setActiveTab} />
          </div>

          {/* Tab content */}
          <div className="px-4 py-3">
            {activeTab === "connection" ? (
              <ConnectionTab stats={stats} />
            ) : (
              <PrivacyTab />
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-3 border-t border-rm-border flex items-center gap-3 text-[12px] font-medium">
            <span className="flex items-center gap-1.5 text-[#23a559]">
              <LockIcon />
              End-to-end encrypted
            </span>
            <span className="flex-1" />
            {stats ? (
              <>
                <button
                  onClick={handleDebug}
                  className="text-rm-text-link hover:underline transition-colors flex items-center gap-1 outline-none"
                >
                  Debug <ExternalLinkIcon />
                </button>
                <button
                  onClick={handleCopyStats}
                  className="text-rm-text-link hover:underline transition-colors flex items-center gap-1 outline-none"
                >
                  {copyFeedback ? "Copied!" : "Copy Stats"} <ClipboardIcon />
                </button>
              </>
            ) : (
              <span className="text-rm-text-muted/50 text-[11px]">Connecting…</span>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// ── Tab Button ──────────────────────────────────────────────────────────────

function TabButton({ id, label, active, onSelect }: {
  id: TabId;
  label: string;
  active: TabId;
  onSelect: (id: TabId) => void;
}) {
  const isActive = active === id;
  return (
    <button
      onClick={() => onSelect(id)}
      className={`pb-2 text-[13px] font-semibold border-b-2 transition-colors outline-none ${isActive
        ? "text-rm-text-link border-rm-text-link"
        : "text-rm-text-muted border-transparent hover:text-rm-text hover:border-rm-text-muted/30"
        }`}
    >
      {label}
    </button>
  );
}

// ── Connection Tab ──────────────────────────────────────────────────────────

function ConnectionTab({ stats }: { stats: VoiceConnectionStats | null }) {
  if (!stats) {
    return (
      <div className="text-center text-rm-text-muted text-[12px] py-6">
        Collecting connection data…
      </div>
    );
  }

  const chartData = stats.pingHistory.length > 0
    ? stats.pingHistory
    : [{ time: "now", ping: 0 }];

  const maxPing = Math.max(...chartData.map(d => d.ping), 20);
  const yMax = Math.ceil(maxPing / 10) * 10;

  return (
    <div className="space-y-3">
      {/* Ping Chart */}
      <div className="bg-rm-bg-surface rounded-lg p-2 border border-rm-border">
        <Suspense fallback={<div className="h-[80px] w-full flex items-center justify-center text-[10px] text-rm-text-muted">Loading chart...</div>}>
          <ResponsiveContainer width="100%" height={80}>
            <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="pingGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#23a559" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#23a559" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="time"
                tick={{ fontSize: 9, fill: "var(--rm-text-muted)" }}
                axisLine={false}
                tickLine={false}
                interval="preserveStartEnd"
                minTickGap={60}
              />
              <YAxis
                domain={[0, yMax]}
                tick={{ fontSize: 9, fill: "var(--rm-text-muted)" }}
                axisLine={false}
                tickLine={false}
                width={28}
                tickCount={3}
              />
              <ReTooltip
                contentStyle={{
                  backgroundColor: "var(--rm-bg-floating)",
                  border: "1px solid var(--rm-border)",
                  borderRadius: "8px",
                  fontSize: "11px",
                  fontWeight: 600,
                  color: "var(--rm-text)",
                  padding: "4px 8px",
                }}
                formatter={(value: any) => [`${value ?? 0} ms`, "Ping"]}
                labelStyle={{ color: "var(--rm-text-muted)", fontSize: "10px" }}
              />
              <Area
                type="monotone"
                dataKey="ping"
                stroke="#23a559"
                strokeWidth={1.5}
                fill="url(#pingGradient)"
                dot={false}
                activeDot={{ r: 3, fill: "#23a559", stroke: "#23a559" }}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </Suspense>
      </div>

      {/* Server + Stats */}
      <div className="space-y-1.5">
        <p className="text-[12px] font-mono text-rm-text-muted tracking-tight">
          {stats.serverIdentifier}
        </p>
        <div className="text-[13px] text-rm-text space-y-0.5">
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
            <span className="font-bold text-rm-text">{(stats.packetLossRate * 100).toFixed(1)}%</span>
          </p>
        </div>
      </div>

      {/* Info Blurb */}
      <div className="text-[11px] text-rm-text-muted leading-relaxed bg-rm-bg-surface/50 rounded-lg p-2.5 border border-rm-border">
        You may notice delayed audio at 250 ms or higher. You may sound robotic if your
        packet loss rate is over 10%. If the problem persists, disconnect and try again.
      </div>
    </div>
  );
}

// ── Privacy Tab ─────────────────────────────────────────────────────────────

function PrivacyTab() {
  return (
    <div className="py-4 space-y-3">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-[#23a559]/10 flex items-center justify-center">
          <LockIcon className="text-[#23a559]" size={20} />
        </div>
        <div>
          <p className="text-[14px] font-bold text-rm-text">End-to-End Encrypted</p>
          <p className="text-[12px] text-rm-text-muted">
            Your voice connection is secured with DTLS-SRTP encryption.
          </p>
        </div>
      </div>
      <div className="text-[11px] text-rm-text-muted leading-relaxed bg-rm-bg-surface/50 rounded-lg p-2.5 border border-rm-border">
        Audio and video data is encrypted in transit using DTLS-SRTP. Only participants
        in this voice channel can hear or see your media.
      </div>
    </div>
  );
}

// ── Inline SVG Icons ────────────────────────────────────────────────────────

function LockIcon({ className = "", size = 14 }: { className?: string; size?: number }) {
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
    <svg xmlns="http://www.w3.org/2000/svg" width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15,3 21,3 21,9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

function ClipboardIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect width="8" height="4" x="8" y="2" rx="1" ry="1" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
    </svg>
  );
}
