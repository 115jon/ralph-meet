import {
  classifyVoiceQuality,
  type VoiceQualityLevel,
} from "@/hooks/useVoiceStats";
import { clog } from "@/lib/console-logger";
import type { SFUClient, VoiceConnectionStats } from "@/lib/sfu-client";
import { buildVoiceDiagnosticsBundle } from "@/lib/voice/diagnostics";
import { cn } from "@/lib/utils";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import InlineEmojiText from "@/components/chat/InlineEmojiText";
import { Button, Spinner } from "@/components/ui/button";
import { Icon, type IconName } from "@/components/ui/icon";
import { LedLabel, type LedState } from "@/components/ui/led";
import { Num } from "@/components/ui/num";
import { RuleCard } from "@/components/ui/plate";
import {
  SIDEBAR_ICON_SLOT,
  SIDEBAR_ROW,
  SIDEBAR_ROW_IDLE,
  SIDEBAR_ROW_SELECTED,
  TREE_BRANCH_GAP,
  TREE_BRANCH_LABEL,
} from "@/components/ui/sidebar-row";
import {
  DitherReadouts,
  DitherTimeline,
  type TimelineLane,
} from "./DitherChart";
import {
  CONNECTION_METRICS,
  type ChartMetric,
  type ChartSample,
  type ConnectionMetricKey,
} from "./dither-chart-model";

const log = clog("VoiceDebug");

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
  transportHistory: {
    time: string;
    timestamp: number;
    availableOutgoingBitrate: number;
    ping: number;
    outboundBitrate: number;
    inboundBitrate: number;
    packetsReceived: number;
    packetsSent: number;
    bytesReceived: number;
    bytesSent: number;
  }[];
  inboundHistory: Record<
    string,
    {
      time: string;
      timestamp: number;
      bitrate: number;
      packetsReceived: number;
      packetsLost: number;
      jitter: number;
    }[]
  >;
  connStats: VoiceConnectionStats | null;
  pulledTracks: { track_name: string; participant_id: string; kind: string }[];
}

/** Same mapping as the details popover's chart status. */
const QUALITY_STATUS: Record<
  VoiceQualityLevel,
  { led: LedState; label: string }
> = {
  connecting: { led: "off", label: "Connecting" },
  good: { led: "talk", label: "Stable" },
  warn: { led: "idle", label: "Unsteady" },
  bad: { led: "muted", label: "Poor" },
};

/** A transport state's light: connected talk, failed muted, pending idle. */
export function connectionStateLed(state: string): LedState {
  if (state === "connected") return "talk";
  if (state === "failed" || state === "closed" || state === "disconnected") {
    return "muted";
  }
  if (state === "idle" || state === "new") return "off";
  return "idle";
}

const COPIED_MS = 2000;

const formatBytes = (b: number) => {
  if (b >= 1e9) return `${(b / 1e9).toFixed(2)} GB`;
  if (b >= 1e6) return `${(b / 1e6).toFixed(2)} MB`;
  if (b >= 1e3) return `${(b / 1e3).toFixed(2)} KB`;
  return `${b} B`;
};

const formatKbps = (v: number) => `${Math.max(0, v / 1000).toFixed(2)} kbps`;

const formatConnectionStateLabel = (state: string) =>
  state.replace(/-/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());

const formatRelativeSampleTime = (timestamp: number | null | undefined) => {
  if (!timestamp) return "Awaiting sample";
  const ageMs = Date.now() - timestamp;
  if (ageMs < 2_000) return "Live";
  if (ageMs < 60_000) return `${Math.round(ageMs / 1_000)}s ago`;
  return `${Math.round(ageMs / 60_000)}m ago`;
};

const shortTrackName = (name: string) =>
  name.replace(/^(cam|screen)-(audio|video)-/, "").slice(0, 12);

const trackIcon = (name: string): IconName =>
  name.includes("audio")
    ? "speaker"
    : name.includes("video")
      ? "camera"
      : "download";

export function VoiceDebugScreen({
  sfu,
  onClose,
  channelName = "Voice",
}: VoiceDebugScreenProps) {
  const [section, setSection] = useState<SidebarSection>("transport");
  const [data, setData] = useState<DebugData | null>(null);
  const [copied, setCopied] = useState(false);

  // One read per stats snapshot (the hub's 2 s tick) rather than a timer of
  // our own: the series only change when a snapshot lands. The first read
  // opens the screen on the history gathered so far.
  useEffect(() => {
    if (!sfu) return;
    const update = () => setData(sfu.getDebugData());
    update();
    return sfu.subscribeConnectionStats(update);
  }, [sfu]);

  // Close on escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  // "Copied" reverts after a beat; one timeout per copy, cleared on unmount.
  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), COPIED_MS);
    return () => window.clearTimeout(id);
  }, [copied]);

  const handleCopyStats = useCallback(async () => {
    if (!sfu) return;
    try {
      const detailed = await sfu.getDetailedStats();
      const diagnostics = buildVoiceDiagnosticsBundle({
        detailedStats: detailed,
        connectionStats: data?.connStats ?? null,
        channelName,
        locationHref: window.location.href,
        userAgent: navigator.userAgent,
      });
      await navigator.clipboard.writeText(
        JSON.stringify(
          {
            ...diagnostics,
            liveDebug: data,
          },
          null,
          2,
        ),
      );
      setCopied(true);
    } catch (err) {
      log.error("Failed to copy stats:", err);
    }
  }, [channelName, data, sfu]);

  if (!data) {
    return (
      <div className="fixed inset-0 z-100 flex flex-col items-center justify-center gap-4 bg-ply-0 text-ink-1">
        <Spinner className="size-6 text-accent-ink" />
        <p className="silkscreen text-ink-3" role="status">
          Gathering RTC metrics…
        </p>
      </div>
    );
  }

  const inboundTrackNames = Object.keys(data.inboundHistory);
  const stats = data.connStats;
  const sessionState = stats?.connectionState ?? data.connectionState;

  const overview = <SessionOverview data={data} />;

  return (
    <div className="fixed inset-0 z-100 flex flex-col overflow-hidden bg-ply-0 pb-[var(--safe-area-bottom,0px)] text-ui-sm text-ink-1">
      {/* Top bar. Full-screen overlay: it clears the notch / status bar. */}
      <header className="flex min-h-12 shrink-0 items-center justify-between gap-3 border-b border-line bg-ply-1 px-3 pt-[calc(var(--safe-area-top,0px)+0.5rem)] pb-2 sm:px-5">
        <p className="silkscreen flex min-w-0 items-baseline gap-1.5 text-ink-3">
          <span className="shrink-0">RTC debug ·</span>
          <InlineEmojiText
            text={data.roomSlug}
            className="min-w-0 truncate text-ink-1"
          />
        </p>
        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          <Button variant="secondary" size="sm" onClick={handleCopyStats}>
            <Icon name={copied ? "check" : "copy"} size="sm" />
            {copied ? (
              "Copied"
            ) : (
              <span>
                Copy<span className="hidden sm:inline"> diagnostics</span>
              </span>
            )}
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <Icon name="close" size="sm" />
            Close
          </Button>
        </div>
        <span role="status" className="sr-only">
          {copied ? "Diagnostics copied" : ""}
        </span>
      </header>

      <div className="flex flex-1 flex-col overflow-hidden sm:flex-row">
        {/* Sidebar: a tree on desktop, a scrolling strip of rows on phones. */}
        <nav
          aria-label="Debug sections"
          className="shrink-0 border-b border-line bg-ply-1 sm:w-60 sm:overflow-y-auto sm:border-r sm:border-b-0"
        >
          <div className="flex items-center gap-1 overflow-x-auto px-2 py-1.5 scrollbar-none sm:hidden">
            <NavRow
              id="transport"
              label="Transport"
              icon="signal"
              active={section}
              onSelect={setSection}
            />
            <NavRow
              id="outbound"
              label="Outbound"
              icon="upload"
              active={section}
              onSelect={setSection}
            />
            {inboundTrackNames.map((name) => (
              <NavRow
                key={name}
                id={name}
                label={shortTrackName(name)}
                icon={trackIcon(name)}
                active={section}
                onSelect={setSection}
              />
            ))}
          </div>

          <div className="hidden flex-col gap-0.5 px-2 pt-4 pb-3 sm:flex">
            <div className="mb-2 flex min-w-0 flex-col gap-1.5 px-2">
              <InlineEmojiText
                text={channelName}
                className="truncate font-display text-[18px] leading-6 font-extrabold tracking-[-0.02em] text-ink-1"
              />
              <LedLabel state={connectionStateLed(sessionState)}>
                {formatConnectionStateLabel(sessionState)}
              </LedLabel>
            </div>
            <p className={cn(TREE_BRANCH_LABEL, TREE_BRANCH_GAP)}>Session</p>
            <NavRow
              id="transport"
              label="Transport"
              icon="signal"
              active={section}
              onSelect={setSection}
              wide
            />
            <NavRow
              id="outbound"
              label="Outbound"
              icon="upload"
              active={section}
              onSelect={setSection}
              wide
            />
            {inboundTrackNames.length > 0 ? (
              <>
                <p className={cn(TREE_BRANCH_LABEL, "pt-4")}>
                  Inbound
                  <Num className="ml-auto text-ink-3">
                    {inboundTrackNames.length}
                  </Num>
                </p>
                {inboundTrackNames.map((name) => (
                  <NavRow
                    key={name}
                    id={name}
                    label={shortTrackName(name)}
                    icon={trackIcon(name)}
                    active={section}
                    onSelect={setSection}
                    wide
                  />
                ))}
              </>
            ) : null}
          </div>
        </nav>

        {/* Main content */}
        <main className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
          <div className="mx-auto flex max-w-[960px] flex-col gap-10 px-4 pt-5 pb-10 sm:px-8 sm:pt-8">
            {section === "transport" && (
              <TransportSection data={data} overview={overview} />
            )}
            {section === "outbound" && (
              <OutboundSection data={data} overview={overview} />
            )}
            {section !== "transport" && section !== "outbound" && (
              <InboundSection
                trackName={section}
                data={data}
                overview={overview}
              />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

// ── Sidebar row ─────────────────────────────────────────────────────────

function NavRow({
  id,
  label,
  icon,
  active,
  onSelect,
  wide = false,
}: {
  id: string;
  label: string;
  icon: IconName;
  active: string;
  onSelect: (id: string) => void;
  /** Full-width tree row (desktop); otherwise a strip chip (phones). */
  wide?: boolean;
}) {
  const isActive = active === id;
  return (
    <button
      type="button"
      onClick={() => onSelect(id)}
      aria-current={isActive ? "page" : undefined}
      className={cn(
        SIDEBAR_ROW,
        isActive ? SIDEBAR_ROW_SELECTED : SIDEBAR_ROW_IDLE,
        !wide && "w-auto shrink-0 whitespace-nowrap",
      )}
    >
      <span className={SIDEBAR_ICON_SLOT}>
        <Icon name={icon} size="sm" />
      </span>
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );
}

// ── Headings and rows ───────────────────────────────────────────────────

/** The section's poster title with a silkscreen kicker and a status. */
function SectionTitle({
  kicker,
  title,
  titleId,
  status,
}: {
  kicker: ReactNode;
  title: string;
  titleId?: string;
  status?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
      <div className="min-w-0">
        <p className="silkscreen truncate text-ink-3">{kicker}</p>
        <h2
          id={titleId}
          className="mt-2 font-display text-[40px] leading-[36px] font-extrabold tracking-[-0.04em] text-balance text-ink-1 [font-optical-sizing:auto] md:text-[56px] md:leading-[48px]"
        >
          {title}
        </h2>
      </div>
      {status ? <div className="pb-1">{status}</div> : null}
    </div>
  );
}

/** A silkscreen label and a value; numbers go in Num, states in LedLabel. */
function StatRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-4 border-b border-line py-2">
      <dt className="silkscreen shrink-0 text-ink-3">{label}</dt>
      <dd className="flex min-w-0 justify-end text-right text-ink-1">
        {typeof value === "string" || typeof value === "number" ? (
          <Num size="sm" className="truncate">
            {value}
          </Num>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}

function StatGrid({ children }: { children: ReactNode }) {
  return (
    <dl className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">{children}</dl>
  );
}

function StateValue({ state }: { state: string }) {
  return (
    <LedLabel state={connectionStateLed(state)}>
      {formatConnectionStateLabel(state)}
    </LedLabel>
  );
}

/** Session, transports, tracks and the sample age, on every section. */
function SessionOverview({ data }: { data: DebugData }) {
  const stats = data.connStats;
  const sessionState = stats?.connectionState ?? data.connectionState;
  const publishState = stats?.publishConnectionState ?? "idle";
  const subscribeState =
    stats?.subscribeConnectionState ??
    (data.pulledTracks.length > 0 ? "connecting" : "idle");
  const remoteTrackCount = stats?.remoteTrackCount ?? data.pulledTracks.length;
  return (
    <RuleCard legend="Session" title="Overview">
      <StatGrid>
        <StatRow label="Session" value={<StateValue state={sessionState} />} />
        <StatRow label="Publish" value={<StateValue state={publishState} />} />
        <StatRow
          label="Subscribe"
          value={<StateValue state={subscribeState} />}
        />
        <StatRow label="Remote tracks" value={remoteTrackCount} />
        <StatRow
          label="Last sample"
          value={formatRelativeSampleTime(stats?.timestamp ?? null)}
        />
      </StatGrid>
    </RuleCard>
  );
}

// ── Chart lanes ─────────────────────────────────────────────────────────

const [M_BITRATE, M_LOSS, M_JITTER, M_RTT] = CONNECTION_METRICS as [
  ChartMetric<ConnectionMetricKey>,
  ChartMetric<ConnectionMetricKey>,
  ChartMetric<ConnectionMetricKey>,
  ChartMetric<ConnectionMetricKey>,
];

/** The uplink, from the snapshot's sample ring (same series as the popover). */
const UPLINK_LANES: TimelineLane<ConnectionMetricKey>[] = [
  { metric: M_BITRATE, height: 72 },
  { metric: M_RTT, height: 48 },
  { metric: M_JITTER, height: 40 },
  { metric: M_LOSS, kind: "density" },
];

type BandwidthKey = "available" | "inbound";
const BANDWIDTH_LANES: TimelineLane<BandwidthKey>[] = [
  {
    metric: {
      key: "available",
      label: "Available out",
      unit: "kbps",
      max: 500,
    },
    height: 56,
  },
  {
    metric: { key: "inbound", label: "Inbound", unit: "kbps", max: 80 },
    height: 56,
  },
];

type OutboundKey = "bitrate" | "packets";
const OUTBOUND_LANES: TimelineLane<OutboundKey>[] = [
  {
    metric: { key: "bitrate", label: "Bitrate", unit: "kbps", max: 80 },
    height: 64,
  },
  {
    metric: { key: "packets", label: "Packets sent", unit: "pkt/s", max: 60 },
    height: 40,
  },
];

type InboundKey = "bitrate" | "jitter" | "loss" | "packets";
const INBOUND_LANES: TimelineLane<InboundKey>[] = [
  {
    metric: { key: "bitrate", label: "Bitrate", unit: "kbps", max: 80 },
    height: 64,
  },
  { metric: { ...M_JITTER, key: "jitter" }, height: 40 },
  {
    metric: { key: "packets", label: "Packets", unit: "pkt/s", max: 60 },
    height: 40,
  },
  { metric: { ...M_LOSS, key: "loss" }, kind: "density" },
];

/** Per-second rate of a cumulative counter between adjacent samples. */
function rate(
  prev: { timestamp: number } | undefined,
  next: { timestamp: number },
  delta: number,
) {
  if (!prev) return 0;
  const dt = (next.timestamp - prev.timestamp) / 1000;
  return dt > 0 ? Math.max(0, Math.round(delta / dt)) : 0;
}

const kbps = (bps: number) => Math.round(Math.max(0, bps) / 100) / 10;

const EMPTY: never[] = [];

// ── Transport Section ───────────────────────────────────────────────────

function TransportSection({
  data,
  overview,
}: {
  data: DebugData;
  overview: ReactNode;
}) {
  const stats = data.connStats;
  const history = data.transportHistory;
  const latest = history[history.length - 1];
  const quality = QUALITY_STATUS[classifyVoiceQuality(stats)];
  const bandwidth = useMemo<ChartSample<BandwidthKey>[]>(
    () =>
      history.map((h) => ({
        t: h.timestamp,
        available: kbps(h.availableOutgoingBitrate),
        inbound: kbps(h.inboundBitrate),
      })),
    [history],
  );

  return (
    <>
      <section aria-labelledby="rtc-debug-title" className="flex flex-col">
        <SectionTitle
          kicker={<>Transport · {data.participantId || "unknown"}</>}
          title="Connection"
          titleId="rtc-debug-title"
          status={<LedLabel state={quality.led}>{quality.label}</LedLabel>}
        />
        <DitherReadouts
          metrics={CONNECTION_METRICS}
          samples={stats?.samples ?? EMPTY}
          className="mt-6"
        />
        <DitherTimeline
          title="Audio uplink"
          meta={stats?.codec?.name}
          lanes={UPLINK_LANES}
          samples={stats?.samples ?? EMPTY}
          className="mt-2"
        />
      </section>

      <DitherTimeline
        title="Bandwidth"
        meta="estimates"
        lanes={BANDWIDTH_LANES}
        samples={bandwidth}
      />

      {overview}

      <RuleCard legend="Transport" title="Network">
        <StatGrid>
          <StatRow
            label="Local address"
            value={stats?.localAddress || "(unknown)"}
          />
          <StatRow
            label="Remote address"
            value={stats?.remoteAddress || "(unknown)"}
          />
          <StatRow
            label="Outbound estimate"
            value={formatKbps(latest?.outboundBitrate ?? 0)}
          />
          <StatRow
            label="Inbound estimate"
            value={formatKbps(latest?.inboundBitrate ?? 0)}
          />
          <StatRow
            label="Packets received"
            value={(latest?.packetsReceived ?? 0).toLocaleString()}
          />
          <StatRow
            label="Packets sent"
            value={(latest?.packetsSent ?? 0).toLocaleString()}
          />
          <StatRow
            label="Bytes received"
            value={formatBytes(latest?.bytesReceived ?? 0)}
          />
          <StatRow
            label="Bytes sent"
            value={formatBytes(latest?.bytesSent ?? 0)}
          />
        </StatGrid>
      </RuleCard>

      <RuleCard legend="Media" title="Codec">
        <StatGrid>
          <StatRow
            label="Codec"
            value={
              stats?.codec ? `${stats.codec.name} (${stats.codec.id})` : "N/A"
            }
          />
          <StatRow label="Sample rate" value={`${stats?.sampleRate ?? 0} Hz`} />
          <StatRow
            label="Session loss"
            value={`${((stats?.packetLossRate ?? 0) * 100).toFixed(2)}%`}
          />
        </StatGrid>
      </RuleCard>
    </>
  );
}

// ── Outbound Section ────────────────────────────────────────────────────

function OutboundSection({
  data,
  overview,
}: {
  data: DebugData;
  overview: ReactNode;
}) {
  const stats = data.connStats;
  const history = data.transportHistory;
  const latest = history[history.length - 1];
  const samples = useMemo<ChartSample<OutboundKey>[]>(
    () =>
      history.map((h, i) => {
        const prev = history[i - 1];
        return {
          t: h.timestamp,
          bitrate: kbps(h.outboundBitrate),
          packets: rate(prev, h, h.packetsSent - (prev?.packetsSent ?? 0)),
        };
      }),
    [history],
  );

  return (
    <>
      <SectionTitle kicker="Publish" title="Outbound" />

      <DitherTimeline
        title="Outbound"
        meta={stats?.codec?.name}
        lanes={OUTBOUND_LANES}
        samples={samples}
      />

      <RuleCard legend="Media" title="Encoder">
        <StatGrid>
          <StatRow
            label="Codec"
            value={
              stats?.codec ? `${stats.codec.name} (${stats.codec.id})` : "N/A"
            }
          />
          <StatRow
            label="Packets sent"
            value={(latest?.packetsSent ?? 0).toLocaleString()}
          />
          <StatRow
            label="Frames encoded"
            value={(stats?.framesEncoded ?? 0).toLocaleString()}
          />
          <StatRow label="Sample rate" value={`${stats?.sampleRate ?? 0} Hz`} />
          <StatRow
            label="Audio level"
            value={(stats?.audioLevel ?? 0).toFixed(4)}
          />
        </StatGrid>
      </RuleCard>

      {overview}
    </>
  );
}

// ── Inbound Section (per-track) ─────────────────────────────────────────

function InboundSection({
  trackName,
  data,
  overview,
}: {
  trackName: string;
  data: DebugData;
  overview: ReactNode;
}) {
  const history = data.inboundHistory[trackName];
  const latest = history?.[history.length - 1];
  const track = data.pulledTracks.find((t) => t.track_name === trackName);
  // Loss per interval from the cumulative counters, so a burst shows where
  // it happened instead of smearing into a session average.
  const samples = useMemo<ChartSample<InboundKey>[]>(
    () =>
      (history ?? EMPTY).map((h, i) => {
        const prev = history![i - 1];
        const received = h.packetsReceived - (prev?.packetsReceived ?? 0);
        const lost = Math.max(0, h.packetsLost - (prev?.packetsLost ?? 0));
        const total = prev ? received + lost : 0;
        return {
          t: h.timestamp,
          bitrate: kbps(h.bitrate),
          jitter: Math.round(h.jitter * 10000) / 10,
          packets: rate(prev, h, received),
          loss: total > 0 ? Math.round((lost / total) * 1000) / 10 : 0,
        };
      }),
    [history],
  );

  return (
    <>
      <SectionTitle
        kicker={<>Inbound · {track?.kind || "track"}</>}
        title="Inbound"
      />

      <RuleCard
        legend="Track"
        title={<span className="break-all">{trackName}</span>}
      >
        <StatGrid>
          <StatRow
            label="Participant ID"
            value={track?.participant_id || "unknown"}
          />
          <StatRow label="Kind" value={track?.kind || "unknown"} />
        </StatGrid>
      </RuleCard>

      <DitherTimeline
        title="Inbound track"
        meta={track?.kind}
        lanes={INBOUND_LANES}
        samples={samples}
      />

      <RuleCard legend="Counters" title="Receive">
        <StatGrid>
          <StatRow
            label="Packets received"
            value={(latest?.packetsReceived ?? 0).toLocaleString()}
          />
          <StatRow
            label="Packets lost"
            value={(latest?.packetsLost ?? 0).toLocaleString()}
          />
          <StatRow
            label="Jitter"
            value={`${((latest?.jitter ?? 0) * 1000).toFixed(2)} ms`}
          />
        </StatGrid>
      </RuleCard>

      {overview}
    </>
  );
}
