#!/usr/bin/env python3
"""
presentmon-analyze.py - Diff PresentMon A/B captures to diagnose game FPS drops
while screen sharing.

Reads the latest pm_baseline_*.csv and pm_shared_*.csv from %TEMP% (or paths
passed as argv[1], argv[2]) and reports:

  * Effective displayed FPS (baseline vs shared)
  * PresentMode distribution  <-- the key signal
  * Frame-time percentiles (mean / p50 / p95 / p99 / max)
  * GPU work per frame, and video-encode-engine work if --track_gpu_video was on
  * Dropped/not-displayed frame ratio

VERDICT logic:
  - PresentMode changes Independent Flip -> Composed  => present-mode demotion
    (DWM compositing). The FPS loss is NOT encoder GPU contention.
  - PresentMode stays Independent but frame time rises uniformly => GPU/CPU
    contention from the capture+encode pipeline.
  - Frame time becomes vsync-quantized (clusters at refresh divisors) => the
    game hit a sync/limiter path.
"""
import csv
import glob
import os
import sys
import statistics as st

TEMP = os.environ.get("TEMP", ".")


def find_latest(label):
    pats = sorted(glob.glob(os.path.join(TEMP, f"pm_{label}_*.csv")),
                  key=os.path.getmtime, reverse=True)
    return pats[0] if pats else None


def pick(header, *candidates):
    """Return the first header column matching any candidate (case-insensitive,
    ignoring spaces/underscores/parens). PresentMon column names differ between
    versions (e.g. 'msBetweenPresents' v1 vs 'FrameTime'/'CPUStartTime' v2)."""
    norm = {c.lower().replace(" ", "").replace("_", "").replace("(", "")
            .replace(")", ""): c for c in header}
    for cand in candidates:
        key = cand.lower().replace(" ", "").replace("_", "")
        if key in norm:
            return norm[key]
    return None


def load(path):
    with open(path, newline="", encoding="utf-8", errors="replace") as f:
        rdr = csv.DictReader(f)
        header = rdr.fieldnames or []
        rows = list(rdr)
    return header, rows


def fnum(row, col):
    if not col:
        return None
    v = row.get(col, "")
    if v is None or v == "" or v == "NA":
        return None
    try:
        return float(v)
    except ValueError:
        return None


def pct(vals, p):
    if not vals:
        return float("nan")
    s = sorted(vals)
    k = (len(s) - 1) * (p / 100.0)
    lo = int(k)
    hi = min(lo + 1, len(s) - 1)
    return s[lo] + (s[hi] - s[lo]) * (k - lo)


def analyze(path):
    header, rows = load(path)
    if not rows:
        return {"path": path, "rows": 0, "header": header}

    # Frame-time column: v2 uses "FrameTime"/"MsBetweenPresents"; v1 uses
    # "msBetweenPresents". Display interval: "MsBetweenDisplayChange" /
    # "msBetweenDisplayChange".
    c_ft = pick(header, "FrameTime", "msBetweenPresents", "MsBetweenPresents")
    c_disp = pick(header, "msBetweenDisplayChange", "MsBetweenDisplayChange")
    c_mode = pick(header, "PresentMode")
    c_gpu = pick(header, "GPUBusy", "msGPUActive", "GPUTime", "msGPUBusy")
    c_gpuvid = pick(header, "VideoBusy", "GPUVideoBusy", "msGPUVideoActive",
                    "GPUVideoTime")
    c_disphw = pick(header, "AllowsTearing", "Dropped")
    c_dropped = pick(header, "Dropped")

    ft = [v for v in (fnum(r, c_ft) for r in rows) if v and v > 0]
    disp = [v for v in (fnum(r, c_disp) for r in rows) if v and v > 0]
    gpu = [v for v in (fnum(r, c_gpu) for r in rows) if v is not None]
    gpuvid = [v for v in (fnum(r, c_gpuvid) for r in rows) if v is not None]

    modes = {}
    for r in rows:
        m = (r.get(c_mode, "") or "").strip() if c_mode else "?"
        modes[m] = modes.get(m, 0) + 1

    dropped = 0
    if c_dropped:
        for r in rows:
            v = (r.get(c_dropped, "") or "").strip().lower()
            if v in ("1", "true"):
                dropped += 1

    fps_present = (1000.0 / st.mean(ft)) if ft else float("nan")
    fps_display = (1000.0 / st.mean(disp)) if disp else None

    return {
        "path": path, "rows": len(rows), "header": header,
        "c_ft": c_ft, "c_mode": c_mode, "c_gpu": c_gpu, "c_gpuvid": c_gpuvid,
        "ft": ft, "disp": disp, "gpu": gpu, "gpuvid": gpuvid,
        "modes": modes, "dropped": dropped,
        "fps_present": fps_present, "fps_display": fps_display,
    }


def fmt_modes(modes, total):
    if not total:
        return "  (no data)"
    out = []
    for m, n in sorted(modes.items(), key=lambda kv: -kv[1]):
        out.append(f"    {100.0 * n / total:5.1f}%  {m or '(blank)'}  ({n})")
    return "\n".join(out)


def summarize(tag, a):
    print(f"\n{'=' * 64}\n{tag}: {os.path.basename(a['path'])}  ({a['rows']} presents)\n{'=' * 64}")
    if not a["rows"]:
        print("  NO ROWS - capture failed or game name wrong.")
        return
    ft = a["ft"]
    print(f"  Frame-time column : {a['c_ft']}")
    print(f"  Effective FPS     : present={a['fps_present']:.1f}"
          + (f"  display={a['fps_display']:.1f}" if a["fps_display"] else ""))
    if ft:
        print(f"  Frame time (ms)   : mean={st.mean(ft):.3f}  p50={pct(ft, 50):.3f}  "
              f"p95={pct(ft, 95):.3f}  p99={pct(ft, 99):.3f}  max={max(ft):.3f}")
    if a["gpu"]:
        g = a["gpu"]
        print(f"  GPU busy/frame ms : mean={st.mean(g):.3f}  p95={pct(g, 95):.3f}  max={max(g):.3f}")
    if a["gpuvid"]:
        v = a["gpuvid"]
        print(f"  GPU VIDEO/frame ms: mean={st.mean(v):.3f}  p95={pct(v, 95):.3f}  max={max(v):.3f}"
              "   (encode-engine work; our NVENC)")
    if a["dropped"]:
        print(f"  Dropped presents  : {a['dropped']} ({100.0 * a['dropped'] / a['rows']:.1f}%)")
    print(f"  PresentMode mix:")
    print(fmt_modes(a["modes"], a["rows"]))


def dominant_mode(a):
    if not a or not a.get("modes"):
        return ""
    return max(a["modes"].items(), key=lambda kv: kv[1])[0]


def is_independent(mode):
    """A 'good' low-latency present path: fullscreen-exclusive flip/copy
    (prefix 'Hardware:') or borderless MPO independent flip
    (prefix 'Hardware Composed:'). PresentMon prefixes all DWM-composed (bad)
    modes with 'Composed:' instead, so a 'Hardware' prefix == hardware path."""
    return mode.strip().lower().startswith("hardware")


def is_composed(mode):
    """DWM-composed (bad) path. PresentMon marks these with a 'Composed:'
    prefix exactly: 'Composed: Flip', 'Composed: Copy with GPU GDI', etc.
    NOTE: 'Hardware Composed: Independent Flip' (MPO) is NOT this - it is the
    good hardware path, so we must match the PREFIX, not the substring."""
    return mode.strip().lower().startswith("composed:")


def tier_decomposition(control, base, shr):
    """Print the control->baseline->shared FPS decomposition when a control
    (app-not-running) capture is available. Answers 'does the app's mere
    existence cost FPS' separately from 'does sharing cost FPS'."""
    if not control or not control["rows"]:
        return
    cfps = control["fps_present"]
    print(f"\n{'-' * 64}\n  THREE-TIER DECOMPOSITION\n{'-' * 64}")
    print(f"  control  (app not running) : {cfps:7.1f} fps   "
          f"mode='{dominant_mode(control)}'")
    if base and base["rows"]:
        bfps = base["fps_present"]
        d = 100.0 * (cfps - bfps) / cfps if cfps else 0.0
        print(f"  baseline (app open, idle)  : {bfps:7.1f} fps   "
              f"mode='{dominant_mode(base)}'")
        print(f"      -> app-existence cost  : {cfps - bfps:+7.1f} fps "
              f"({-d:+.1f}%)")
    if shr and shr["rows"]:
        sfps = shr["fps_present"]
        ref = base["fps_present"] if (base and base["rows"]) else cfps
        d = 100.0 * (ref - sfps) / ref if ref else 0.0
        print(f"  shared   (app sharing)     : {sfps:7.1f} fps   "
              f"mode='{dominant_mode(shr)}'")
        print(f"      -> sharing cost        : {ref - sfps:+7.1f} fps "
              f"({-d:+.1f}%)")
        if cfps:
            tot = 100.0 * (cfps - sfps) / cfps
            print(f"      -> total vs control    : {cfps - sfps:+7.1f} fps "
                  f"({-tot:+.1f}%)")


def verdict(base, shr, control=None):
    print(f"\n{'#' * 64}\n# VERDICT\n{'#' * 64}")
    tier_decomposition(control, base, shr)
    if not base or not base["rows"] or not shr or not shr["rows"]:
        print("\n  Need BOTH a baseline and a shared capture with data. Re-run the")
        print("  missing label with presentmon-capture.ps1.")
        return

    bfps, sfps = base["fps_present"], shr["fps_present"]
    drop_pct = 100.0 * (bfps - sfps) / bfps if bfps else 0.0
    bmode, smode = dominant_mode(base), dominant_mode(shr)

    print(f"\n  FPS:        baseline {bfps:.1f}  ->  shared {sfps:.1f}   "
          f"({drop_pct:+.1f}% change)")
    print(f"  PresentMode: baseline '{bmode}'  ->  shared '{smode}'")

    # GPU video-engine delta (our encoder's GPU cost) if available.
    if base["gpuvid"] and shr["gpuvid"]:
        print(f"  GPU video engine/frame: baseline {st.mean(base['gpuvid']):.3f}ms"
              f"  ->  shared {st.mean(shr['gpuvid']):.3f}ms")
    if base["gpu"] and shr["gpu"]:
        print(f"  GPU busy/frame:         baseline {st.mean(base['gpu']):.3f}ms"
              f"  ->  shared {st.mean(shr['gpu']):.3f}ms")

    print()
    demoted = is_independent(bmode) and is_composed(smode)
    significant = drop_pct >= 10.0

    if demoted:
        print("  >>> ROOT CAUSE: PRESENT-MODE DEMOTION.")
        print("      The game lost hardware Independent Flip and is now DWM-composed")
        print("      while sharing. This forces vsync/compositor pacing and is the")
        print("      classic cause of a sudden FPS halving. The fix is NOT in the")
        print("      encoder - it is in how the capture/overlay forces composition.")
        print("      Investigate: borderless vs exclusive fullscreen, MPO, the hook's")
        print("      Present interaction, and whether any Ralph overlay window sits")
        print("      over the game surface.")
    elif significant and is_independent(smode):
        print("  >>> ROOT CAUSE: RESOURCE CONTENTION (mode unchanged).")
        print("      The game kept Independent Flip but frame time rose. The FPS loss")
        print("      is GPU/CPU contention from capture+encode. Compare the GPU-busy")
        print("      and GPU-video deltas above; tune VP-blit cost / GPU priority /")
        print("      capture rate accordingly.")
    elif significant:
        print("  >>> FPS dropped but PresentMode is ambiguous. Inspect the mode mix")
        print("      and frame-time percentiles above; check for vsync quantization")
        print("      (frame times clustering at refresh divisors).")
    else:
        print("  >>> No significant FPS drop in THIS capture. If the user still sees")
        print("      drops, ensure the game was uncapped and actually being shared")
        print("      during the 'shared' capture, then re-run.")


def main():
    if len(sys.argv) >= 3:
        bpath, spath = sys.argv[1], sys.argv[2]
        cpath = sys.argv[3] if len(sys.argv) >= 4 else find_latest("control")
    else:
        cpath = find_latest("control")
        bpath, spath = find_latest("baseline"), find_latest("shared")

    print(f"control:  {cpath}")
    print(f"baseline: {bpath}")
    print(f"shared:   {spath}")
    control = analyze(cpath) if cpath else None
    base = analyze(bpath) if bpath else None
    shr = analyze(spath) if spath else None
    if control:
        summarize("CONTROL", control)
    if base:
        summarize("BASELINE", base)
    if shr:
        summarize("SHARED", shr)
    verdict(base, shr, control)


if __name__ == "__main__":
    main()
