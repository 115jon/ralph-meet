// Injected into every bench page before the app loads (addInitScript).
// Records, with epoch-ms timestamps (performance.timeOrigin + now):
//   - every RTCPeerConnection and its ICE / connection / signaling states,
//   - every getUserMedia call, when it resolved and when its tracks stopped,
//   - first RTP per inbound/outbound audio stream and first audible level,
//     from a getStats sampler the bench starts and stops around a run,
//   - when the voice header first reads "Connected".
// It also lets the bench fake a hidden tab (document.visibilityState).
// Nothing here runs unless the bench injects it; the app never ships it.
(() => {
  if (window.__vb) return;
  // Vite dev loads hundreds of modules; the default 250-entry buffer would
  // be full before the first join.
  performance.setResourceTimingBufferSize?.(20_000);
  const now = () => performance.timeOrigin + performance.now();
  const vb = {
    pcs: [],
    pcEvents: [],
    gum: [],
    rtp: { inbound: {}, outbound: {} },
    connectedText: [],
    sampler: null,
    hidden: false,
  };
  window.__vb = vb;

  // ── RTCPeerConnection ───────────────────────────────────────────────
  const NativePC = window.RTCPeerConnection;
  if (NativePC) {
    const Wrapped = function (...args) {
      const pc = new NativePC(...args);
      const index = vb.pcs.length;
      vb.pcs.push(pc);
      const record = (kind, state) =>
        vb.pcEvents.push({ t: now(), pc: index, kind, state });
      record("created", "new");
      pc.addEventListener("iceconnectionstatechange", () =>
        record("ice", pc.iceConnectionState),
      );
      pc.addEventListener("connectionstatechange", () =>
        record("connection", pc.connectionState),
      );
      pc.addEventListener("icegatheringstatechange", () =>
        record("gathering", pc.iceGatheringState),
      );
      pc.addEventListener("signalingstatechange", () =>
        record("signaling", pc.signalingState),
      );
      pc.addEventListener("track", (event) =>
        record("track", event.track.kind),
      );
      return pc;
    };
    Wrapped.prototype = NativePC.prototype;
    Object.setPrototypeOf(Wrapped, NativePC);
    window.RTCPeerConnection = Wrapped;
  }

  // ── getUserMedia ────────────────────────────────────────────────────
  const md = navigator.mediaDevices;
  if (md?.getUserMedia) {
    const nativeGum = md.getUserMedia.bind(md);
    md.getUserMedia = async (constraints) => {
      const entry = {
        start: now(),
        end: null,
        audio: !!constraints?.audio,
        video: !!constraints?.video,
        tracks: [],
        error: null,
      };
      vb.gum.push(entry);
      try {
        const stream = await nativeGum(constraints);
        entry.end = now();
        for (const track of stream.getTracks()) {
          const info = { kind: track.kind, stoppedAt: null, track };
          entry.tracks.push(info);
          track.addEventListener("ended", () => {
            info.stoppedAt ??= now();
          });
          const stop = track.stop.bind(track);
          track.stop = () => {
            info.stoppedAt ??= now();
            stop();
          };
        }
        return stream;
      } catch (error) {
        entry.end = now();
        entry.error = String(error?.name ?? error);
        throw error;
      }
    };
  }

  // ── Fake tab visibility ─────────────────────────────────────────────
  Object.defineProperty(document, "hidden", {
    configurable: true,
    get: () => vb.hidden,
  });
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => (vb.hidden ? "hidden" : "visible"),
  });
  vb.setHidden = (hidden) => {
    vb.hidden = hidden;
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event(hidden ? "blur" : "focus"));
  };

  // ── "Connected" in the voice header ─────────────────────────────────
  const watchConnected = () => {
    const observer = new MutationObserver(() => {
      const visible = [...document.querySelectorAll("span,div,p")].some(
        (element) =>
          element.childElementCount === 0 &&
          element.textContent === "Connected",
      );
      const last = vb.connectedText.at(-1);
      if (visible !== (last?.visible ?? false)) {
        vb.connectedText.push({ t: now(), visible });
      }
    });
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  };
  if (document.documentElement) watchConnected();
  else document.addEventListener("DOMContentLoaded", watchConnected);

  // ── getStats sampler ────────────────────────────────────────────────
  vb.startSampler = (intervalMs = 20, levelThreshold = 0.01) => {
    vb.stopSampler();
    vb.rtp = { inbound: {}, outbound: {}, startedAt: now() };
    let busy = false;
    const tick = async () => {
      if (busy) return;
      busy = true;
      try {
        await Promise.all(
          vb.pcs.map(async (pc, index) => {
            if (pc.connectionState === "closed") return;
            const report = await pc.getStats();
            const t = now();
            report.forEach((stat) => {
              if (stat.kind !== "audio") return;
              if (stat.type === "inbound-rtp") {
                const key = `${index}:${stat.ssrc}`;
                const entry = (vb.rtp.inbound[key] ??= {
                  pc: index,
                  mid: stat.mid,
                  trackIdentifier: stat.trackIdentifier,
                  firstSeen: t,
                  firstPacket: null,
                  firstAudible: null,
                  packetsAtFirstSeen: stat.packetsReceived ?? 0,
                  packets: 0,
                  maxLevel: 0,
                  lastIncrease: null,
                  maxGap: 0,
                  resumes: [],
                });
                const packets = stat.packetsReceived ?? 0;
                if (packets > entry.packets) {
                  const gap = t - (entry.lastIncrease ?? t);
                  if (gap > entry.maxGap) entry.maxGap = gap;
                  if (gap >= 250) entry.resumes.push({ t, gap });
                  entry.lastIncrease = t;
                }
                entry.packets = packets;
                entry.maxLevel = Math.max(entry.maxLevel, stat.audioLevel ?? 0);
                if (!entry.firstPacket && entry.packets > 0)
                  entry.firstPacket = t;
                if (
                  !entry.firstAudible &&
                  (stat.audioLevel ?? 0) >= levelThreshold
                )
                  entry.firstAudible = t;
              } else if (stat.type === "media-source") {
                // What this page feeds its encoder (after any gate).
                const source = (vb.rtp.source ??= {
                  maxLevel: 0,
                  lastLevel: 0,
                });
                source.lastLevel = stat.audioLevel ?? 0;
                source.maxLevel = Math.max(source.maxLevel, source.lastLevel);
              } else if (stat.type === "outbound-rtp") {
                const key = `${index}:${stat.ssrc}`;
                const entry = (vb.rtp.outbound[key] ??= {
                  pc: index,
                  mid: stat.mid,
                  firstSeen: t,
                  firstPacket: null,
                  packetsAtFirstSeen: stat.packetsSent ?? 0,
                  packets: 0,
                });
                entry.packets = stat.packetsSent ?? 0;
                if (!entry.firstPacket && entry.packets > 0)
                  entry.firstPacket = t;
              }
            });
          }),
        );
      } catch {
        // A PC closing mid-sample is fine; the next tick skips it.
      } finally {
        busy = false;
      }
    };
    vb.sampler = setInterval(tick, intervalMs);
    void tick();
  };
  vb.stopSampler = () => {
    if (vb.sampler) clearInterval(vb.sampler);
    vb.sampler = null;
  };

  // ── Snapshots for the bench ─────────────────────────────────────────
  vb.marks = (since = 0) =>
    performance
      .getEntriesByType("mark")
      .filter((mark) => mark.name.startsWith("voice:"))
      .map((mark) => ({
        name: mark.name.slice("voice:".length),
        t: performance.timeOrigin + mark.startTime,
        detail: mark.detail ?? null,
      }))
      .filter((mark) => mark.t >= since);
  vb.resources = (since = 0) =>
    performance
      .getEntriesByType("resource")
      .filter((entry) => performance.timeOrigin + entry.startTime >= since)
      .map((entry) => ({
        name: entry.name.replace(/[?#].*$/, ""),
        start: performance.timeOrigin + entry.startTime,
        end: performance.timeOrigin + entry.responseEnd,
        method: entry.initiatorType,
        serverTiming: (entry.serverTiming ?? []).map((timing) => ({
          name: timing.name,
          dur: timing.duration,
        })),
      }));
  vb.candidatePairs = async () => {
    const pairs = [];
    for (const [index, pc] of vb.pcs.entries()) {
      if (pc.connectionState === "closed") continue;
      const report = await pc.getStats();
      const byId = new Map();
      report.forEach((stat) => byId.set(stat.id, stat));
      report.forEach((stat) => {
        if (stat.type !== "transport" || !stat.selectedCandidatePairId) return;
        const pair = byId.get(stat.selectedCandidatePairId);
        if (!pair) return;
        const local = byId.get(pair.localCandidateId);
        const remote = byId.get(pair.remoteCandidateId);
        pairs.push({
          pc: index,
          rttMs:
            pair.currentRoundTripTime != null
              ? pair.currentRoundTripTime * 1000
              : null,
          local:
            local &&
            `${local.candidateType}/${local.protocol}${local.relayProtocol ? `/${local.relayProtocol}` : ""}`,
          remote: remote && `${remote.candidateType}/${remote.protocol}`,
        });
      });
    }
    return pairs;
  };
  vb.liveMicrophones = () =>
    vb.gum.flatMap((entry) =>
      entry.tracks
        .filter(
          (info) => info.kind === "audio" && info.track.readyState === "live",
        )
        .map(() => ({ requestedAt: entry.start })),
    );
  vb.snapshot = (since = 0) => ({
    now: now(),
    marks: vb.marks(since),
    resources: vb.resources(since),
    pcEvents: vb.pcEvents.filter((event) => event.t >= since),
    pcStates: vb.pcs.map((pc) => ({
      connection: pc.connectionState,
      ice: pc.iceConnectionState,
    })),
    gum: vb.gum.map((entry) => ({
      start: entry.start,
      end: entry.end,
      audio: entry.audio,
      video: entry.video,
      error: entry.error,
      tracks: entry.tracks.map((info) => ({
        kind: info.kind,
        stoppedAt: info.stoppedAt,
        live: info.track.readyState === "live",
      })),
    })),
    rtp: vb.rtp,
    connectedText: vb.connectedText.filter((event) => event.t >= since),
  });
})();
