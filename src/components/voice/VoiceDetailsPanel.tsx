import { useMounted } from "@/hooks/useMounted";
import {
  classifyVoiceQuality,
  useVoiceStats,
  type VoiceQualityLevel,
} from "@/hooks/useVoiceStats";
import { clog } from "@/lib/console-logger";
import type { SFUClient, VoiceConnectionStats } from "@/lib/sfu-client";
import { buildVoiceDiagnosticsBundle } from "@/lib/voice/diagnostics";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/ui/icon";
import { Num } from "@/components/ui/num";
import { ResponsivePopover } from "@/components/ui/popover";
import { Tabs, tabId } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { LedLabel, type LedState } from "@/components/ui/led";
import { DitherSmallMultiples } from "./DitherChart";
import { CONNECTION_METRICS } from "./dither-chart-model";
import { connectionStateLed, VoiceDebugScreen } from "./VoiceDebugScreen";

const log = clog("VoiceDetails");

const LIVE_CONNECTION_POLL_MS = 1000;
/**
 * The popover charts the last 48 s (24 samples at the 2 s tick): about 5–6px
 * per bar in its ~140px tiles, so bars stay whole dither cells.
 */
const CHART_CAPACITY = 24;

const QUALITY_STATUS: Record<
  VoiceQualityLevel,
  { led: LedState; label: string }
> = {
  connecting: { led: "off", label: "Connecting" },
  good: { led: "talk", label: "Stable" },
  warn: { led: "idle", label: "Unsteady" },
  bad: { led: "muted", label: "Poor" },
};

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

type StateTone = "good" | "pending" | "bad";

/** Settled states read without an ellipsis; transitional ones keep it. */
function describeConnectionState(state: string): {
  label: string;
  tone: StateTone;
} {
  const label = formatConnectionStateLabel(state);
  if (state === "connected") return { label, tone: "good" };
  if (state === "failed" || state === "closed" || state === "disconnected") {
    return { label, tone: "bad" };
  }
  return { label: `${label}…`, tone: "pending" };
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
        <h3 className="font-display text-[22px] leading-7 font-extrabold tracking-[-0.03em] text-ink-1 [font-optical-sizing:auto]">
          Voice details
        </h3>
      </div>

      {/* Tabs: the list is inset 4px inside a 12px wrapper, so tab text sits
          on the 16px content inset and the focus ring isn't clipped. */}
      <div className="border-b border-line px-3">
        <Tabs
          label="Voice details sections"
          items={TAB_ITEMS}
          value={activeTab}
          onValueChange={setActiveTab}
          idBase={TABS_ID}
          panelId={PANEL_ID}
          className="h-10 px-1 py-1"
        />
      </div>

      {/* Tab content */}
      <div
        role="tabpanel"
        id={PANEL_ID}
        aria-labelledby={tabId(TABS_ID, activeTab)}
        className="px-4 py-3"
      >
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

      {/* Footer: the encryption claim only appears while connected, so it
          never sits next to "Disconnected". */}
      <div className="flex min-h-12 items-center gap-3 border-t border-line px-4 py-2">
        <FooterStatus state={connectionSnapshot.connectionState} />
        <span className="flex-1" />
        {stats ? (
          <>
            <Button variant="link" size="xs" onClick={handleDebug}>
              Debug <Icon name="externalLink" size="xs" />
            </Button>
            <Button variant="link" size="xs" onClick={handleCopyStats}>
              {copyFeedback ? "Copied" : "Copy stats"}{" "}
              <Icon name={copyFeedback ? "check" : "copy"} size="xs" />
            </Button>
          </>
        ) : connectionSnapshot.connectionState === "connected" ? (
          <span className="text-ui-xs font-normal text-ink-3">
            Connected · gathering live metrics…
          </span>
        ) : null}
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

const TABS_ID = "voice-details";
const PANEL_ID = "voice-details-panel";
const TAB_ITEMS = [
  { value: "connection", label: "Connection" },
  { value: "privacy", label: "Privacy" },
] as const satisfies ReadonlyArray<{ value: TabId; label: string }>;

// ── Footer ──────────────────────────────────────────────────────────────────

function FooterStatus({ state }: { state: string }) {
  if (state === "connected") {
    return (
      <LedLabel state="talk">
        <span className="sr-only">End-to-end </span>Encrypted
      </LedLabel>
    );
  }
  const { label, tone } = describeConnectionState(state);
  return (
    <LedLabel
      state={tone === "bad" ? "muted" : "idle"}
      tone={tone === "bad" ? "led" : "plain"}
    >
      {label}
    </LedLabel>
  );
}

// ── Connection Tab ──────────────────────────────────────────────────────────

/** Transport states as silkscreen label over an LED label, three up. */
function SummaryCards({
  cards,
}: {
  cards: { label: string; state: string }[];
}) {
  return (
    <dl className="grid grid-cols-3 gap-x-4">
      {cards.map((card) => (
        <div key={card.label} className="min-w-0">
          <dt className="silkscreen text-ink-3">{card.label}</dt>
          <dd className="mt-1.5 flex min-w-0">
            <LedLabel state={connectionStateLed(card.state)}>
              {formatConnectionStateLabel(card.state)}
            </LedLabel>
          </dd>
        </div>
      ))}
    </dl>
  );
}

function StatRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line py-1.5 last:border-b-0">
      <dt className="silkscreen text-ink-3">{label}</dt>
      <dd className="text-ink-1">{children}</dd>
    </div>
  );
}

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
    { label: "Session", state: connectionState },
    { label: "Publish", state: publishConnectionState },
    { label: "Receive", state: subscribeConnectionState },
  ];

  if (!stats) {
    return (
      <div className="space-y-3">
        <SummaryCards cards={summaryCards} />
        <p className="px-1 py-3 text-center text-ui-xs text-ink-3">
          {connectionState === "connected"
            ? "Connected to voice. Gathering latency and packet metrics…"
            : "Connecting to the voice transport…"}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <SummaryCards cards={summaryCards} />

      {/* Uplink small multiples: fed by the snapshot's bounded sample ring,
          so they redraw once per stats tick and show history on open. */}
      <DitherSmallMultiples
        title="Connection"
        status={QUALITY_STATUS[classifyVoiceQuality(stats)]}
        metrics={CONNECTION_METRICS}
        samples={stats.samples}
        capacity={CHART_CAPACITY}
        compact
      />

      {/* Server + stats */}
      <div className="space-y-1">
        <p className="flex min-w-0 items-baseline gap-2">
          <span className="silkscreen shrink-0 text-ink-3">Server</span>
          <Num size="sm" className="truncate text-ink-2">
            {stats.serverIdentifier}
          </Num>
        </p>
        <dl>
          <StatRow label="Session packet loss">
            <Num size="sm">{(stats.packetLossRate * 100).toFixed(1)}%</Num>
          </StatRow>
          <StatRow label="Remote tracks">
            <Num size="sm">{stats.remoteTrackCount}</Num>
          </StatRow>
        </dl>
      </div>

      <p className="text-ui-xs text-pretty text-ink-3">
        You may notice delayed audio at 250 ms or higher. You may sound robotic
        if your packet loss rate is over 10%. If the problem persists,
        disconnect and try again.
      </p>
    </div>
  );
}

// ── Privacy Tab ─────────────────────────────────────────────────────────────

function PrivacyTab() {
  return (
    <div className="space-y-3 py-2">
      <div className="flex items-center gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-success-tint text-success-ink">
          <Icon name="lock" size="lg" />
        </div>
        <div>
          <p className="text-ui-sm font-semibold text-ink-1">
            End-to-end encrypted
          </p>
          <p className="text-ui-xs text-ink-3">
            Your voice connection is secured with DTLS-SRTP encryption.
          </p>
        </div>
      </div>
      <p className="text-ui-xs text-pretty text-ink-3">
        Audio and video data is encrypted in transit using DTLS-SRTP. Only
        participants in this voice channel can hear or see your media.
      </p>
    </div>
  );
}
