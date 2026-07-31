import SettingsModal from "@/components/chat/SettingsModal";
import { HomeIcon } from "@/components/chat/HomeIcon";
import { UserButton, useAuth } from "@kova/react";
import { useNavigate } from "@tanstack/react-router";
import { ArrowRight, Download, Globe2, MessageSquare, Zap } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { isWindows } from "@/lib/platform";
import { motion, useInView } from "framer-motion";

const subscribeToStaticPlatform = () => () => {};
const getServerWindowsSnapshot = () => false;

interface DesktopRelease {
  tagName: string;
  name: string;
  downloadUrl: string;
  fileName: string;
  isLatest: boolean;
}

const FALLBACK_RELEASES: DesktopRelease[] = [
  {
    tagName: "v1.9.0",
    name: "v1.9.0",
    downloadUrl:
      "https://github.com/115jon/ralph-meet/releases/download/v1.9.0/RalphMeetSetup.exe",
    fileName: "RalphMeetSetup.exe",
    isLatest: true,
  },
];

function HomePageHeader() {
  const { isSignedIn } = useAuth();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled
          ? "bg-rm-bg-primary/80 backdrop-blur-xl border-b border-rm-border"
          : "bg-transparent"
      }`}
    >
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-6 sm:px-10">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-rm-bg-surface text-rm-text ring-1 ring-rm-border">
            <HomeIcon className="h-4 w-4" />
          </div>
          <span className="text-base font-semibold tracking-tight text-rm-text font-[family-name:var(--font-family-body)]">
            Ralph Meet
          </span>
        </div>
        <div className="flex items-center gap-4">
          {!isSignedIn ? (
            <a
              href="/sign-in"
              className="rounded-full bg-rm-accent hover:bg-rm-accent-hover px-4 py-1.5 text-sm font-medium text-white transition-all"
            >
              Sign In
            </a>
          ) : (
            <div className="rounded-full bg-rm-bg-surface/50 p-1 ring-1 ring-rm-border backdrop-blur-xl">
              <UserButton
                afterSignOutUrl="/"
                size={32}
                appearance={{ variables: { colorPrimary: "#5865f2" } }}
              />
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

function HomePageHero({ createRoom }: { createRoom: () => void }) {
  const { isSignedIn } = useAuth();
  const navigate = useNavigate();
  const isWindowsUser = useSyncExternalStore(
    subscribeToStaticPlatform,
    () => isWindows(),
    getServerWindowsSnapshot,
  );
  const [releases, setReleases] = useState<DesktopRelease[]>(FALLBACK_RELEASES);

  useEffect(() => {
    fetch("https://api.github.com/repos/115jon/ralph-meet/releases")
      .then((r) => r.json())
      .then((data: any[]) => {
        const mapped = data
          .filter((r) => r.assets?.some((a: any) => a.name.endsWith(".exe")))
          .map((r, i) => ({
            tagName: r.tag_name,
            name: r.name || r.tag_name,
            downloadUrl: r.assets.find((a: any) => a.name.endsWith(".exe"))
              ?.browser_download_url,
            fileName: r.assets.find((a: any) => a.name.endsWith(".exe"))?.name,
            isLatest: i === 0,
          }));
        if (mapped.length > 0) setReleases(mapped);
      })
      .catch(() => {});
  }, []);

  const latestRelease = releases[0];

  return (
    <section className="relative min-h-screen w-full overflow-hidden bg-rm-bg-primary pt-16">
      {/* Video Background */}
      <video
        autoPlay
        loop
        muted
        playsInline
        className="absolute inset-0 h-full w-full object-cover opacity-20"
      >
        <source
          src="https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260319_015952_e1deeb12-8fb7-4071-a42a-60779fc64ab6.mp4"
          type="video/mp4"
        />
      </video>

      {/* Gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-b from-rm-bg-primary via-transparent to-rm-bg-primary" />

      {/* Content */}
      <div className="relative z-10 mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-7xl flex-col items-center justify-center px-6 py-20 sm:px-10">
        {/* Badge */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="mb-8 inline-flex items-center gap-2 rounded-full border border-rm-border bg-rm-bg-surface/60 px-4 py-1.5 text-xs font-medium text-rm-text-secondary backdrop-blur-sm"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="font-[family-name:var(--font-family-body)]">
            300+ edge nodes worldwide
          </span>
        </motion.div>

        {/* Headline */}
        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="mb-6 max-w-4xl text-center text-5xl font-normal leading-[0.95] tracking-tight text-rm-text sm:text-6xl md:text-7xl lg:text-8xl font-[family-name:var(--font-family-display)]"
        >
          Real-time, <span className="italic text-rm-accent">reimagined</span>
        </motion.h1>

        {/* Subheadline */}
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="mb-10 max-w-2xl text-center text-base leading-relaxed text-rm-text-secondary sm:text-lg font-[family-name:var(--font-family-body)]"
        >
          Instant video rooms, voice hangouts, and team chat. No sign-up
          needed—just share the link and connect.
        </motion.p>

        {/* CTAs */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="mb-16 flex flex-col items-center gap-3 sm:flex-row"
        >
          <button
            onClick={createRoom}
            className="group flex items-center gap-2 rounded-full bg-rm-accent hover:bg-rm-accent-hover px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-rm-accent/20 transition-all hover:scale-[1.02] active:scale-[0.98] font-[family-name:var(--font-family-body)]"
          >
            <Zap className="h-4 w-4 transition-transform group-hover:scale-110" />
            Try It Free
          </button>

          {isWindowsUser && (
            <a
              href={latestRelease.downloadUrl}
              className="flex items-center gap-2 rounded-full border border-rm-border bg-rm-bg-surface/60 hover:bg-rm-bg-elevated px-6 py-3 text-sm font-semibold text-rm-text backdrop-blur-sm transition-all font-[family-name:var(--font-family-body)]"
            >
              <Download className="h-4 w-4" />
              Download for Windows
            </a>
          )}

          <a
            href={isSignedIn ? "/chat" : "/sign-in"}
            className="flex items-center gap-2 rounded-full border border-rm-border bg-rm-bg-surface/60 hover:bg-rm-bg-elevated px-6 py-3 text-sm font-semibold text-rm-text backdrop-blur-sm transition-all font-[family-name:var(--font-family-body)]"
          >
            <MessageSquare className="h-4 w-4" />
            Open Web Chat
          </a>
        </motion.div>

        {/* Product Screenshot */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.5 }}
          className="w-full max-w-6xl"
        >
          <div className="group overflow-hidden rounded-2xl border border-rm-border bg-rm-bg-surface/40 p-2 backdrop-blur-sm transition-all duration-500 hover:border-rm-accent/30 hover:shadow-2xl hover:shadow-rm-accent/10">
            <img
              src="/screenshots/desktop-app.png"
              alt="Ralph Meet Desktop Application"
              className="w-full rounded-lg transition-transform duration-500 group-hover:scale-[1.02]"
            />
          </div>
        </motion.div>
      </div>
    </section>
  );
}

function HomePageFeatures() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });

  return (
    <section
      ref={ref}
      className="relative w-full border-t border-rm-border bg-rm-bg-secondary/20 px-6 py-24 sm:px-10 md:py-32"
    >
      <div className="mx-auto w-full max-w-7xl">
        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ duration: 0.6 }}
          className="mb-20 text-center text-4xl font-normal tracking-tight text-rm-text sm:text-5xl md:text-6xl font-[family-name:var(--font-family-display)]"
        >
          Everything you need to <span className="italic">stay close</span>
        </motion.h2>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Voice Room Card - spans 2 columns, larger */}
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 40 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="group relative overflow-hidden rounded-3xl border border-rm-border bg-gradient-to-br from-rm-bg-surface/40 to-rm-bg-surface/10 p-8 backdrop-blur-sm transition-all duration-500 hover:border-rm-accent/40 hover:shadow-2xl hover:shadow-rm-accent/10 hover:-translate-y-1 lg:col-span-2"
          >
            <div className="mb-6">
              <div className="mb-4 inline-flex rounded-xl bg-emerald-500/10 p-3 ring-1 ring-emerald-500/20">
                <svg
                  className="h-6 w-6 text-emerald-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
                  />
                </svg>
              </div>
              <h3 className="mb-3 text-3xl font-semibold tracking-tight text-rm-text sm:text-4xl font-[family-name:var(--font-family-display)]">
                Voice rooms that feel{" "}
                <span className="italic text-emerald-400">natural</span>
              </h3>
              <p className="text-base leading-relaxed text-rm-text-secondary font-[family-name:var(--font-family-body)]">
                Drop in when you're free. Your friends can see you're around and
                join instantly—no scheduling, no friction.
              </p>
            </div>
            <div className="overflow-hidden rounded-2xl border border-rm-border bg-rm-bg-primary/50 shadow-2xl transition-all duration-500 group-hover:border-emerald-500/30 group-hover:shadow-emerald-500/20">
              <img
                src="/screenshots/voice-room.png"
                alt="Voice Room Interface"
                className="w-full transition-transform duration-700 group-hover:scale-105"
              />
            </div>
            <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-emerald-500/5 blur-3xl transition-all duration-700 group-hover:bg-emerald-500/10" />
          </motion.div>

          {/* Chat Card - 1 column, taller */}
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 40 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="group relative overflow-hidden rounded-3xl border border-rm-border bg-gradient-to-br from-rm-bg-surface/40 to-rm-bg-surface/10 p-8 backdrop-blur-sm transition-all duration-500 hover:border-rm-accent/40 hover:shadow-2xl hover:shadow-rm-accent/10 hover:-translate-y-1"
          >
            <div className="mb-6">
              <div className="mb-4 inline-flex rounded-xl bg-rm-accent/10 p-3 ring-1 ring-rm-accent/20">
                <MessageSquare className="h-6 w-6 text-rm-accent" />
              </div>
              <h3 className="mb-3 text-2xl font-semibold tracking-tight text-rm-text font-[family-name:var(--font-family-display)]">
                Organized conversations
              </h3>
              <p className="text-sm leading-relaxed text-rm-text-secondary font-[family-name:var(--font-family-body)]">
                Topic-based channels keep discussions focused. Share code,
                collaborate, or hang out.
              </p>
            </div>
            <div className="overflow-hidden rounded-xl border border-rm-border bg-rm-bg-primary/50 shadow-xl transition-all duration-500 group-hover:border-rm-accent/30 group-hover:shadow-rm-accent/20">
              <img
                src="/screenshots/chat-ui.png"
                alt="Chat Interface"
                className="w-full transition-transform duration-700 group-hover:scale-105"
              />
            </div>
            <div className="pointer-events-none absolute -left-20 -bottom-20 h-64 w-64 rounded-full bg-rm-accent/5 blur-3xl transition-all duration-700 group-hover:bg-rm-accent/10" />
          </motion.div>

          {/* Edge Network Card - full width */}
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 40 }}
            transition={{ duration: 0.6, delay: 0.3 }}
            className="group relative overflow-hidden rounded-3xl border border-rm-border bg-gradient-to-br from-rm-bg-surface/40 to-rm-bg-surface/10 p-8 lg:col-span-3 backdrop-blur-sm transition-all duration-500 hover:border-rm-accent/40 hover:shadow-2xl hover:shadow-rm-accent/10"
          >
            <div className="relative z-10 mb-8 text-center">
              <div className="mb-4 inline-flex rounded-xl bg-rm-accent/10 p-3 ring-1 ring-rm-accent/20">
                <Globe2 className="h-6 w-6 text-rm-accent" />
              </div>
              <h3 className="mb-3 text-3xl font-semibold tracking-tight text-rm-text font-[family-name:var(--font-family-display)]">
                Built on the global{" "}
                <span className="italic text-rm-accent">edge</span>
              </h3>
              <p className="mx-auto max-w-2xl text-base leading-relaxed text-rm-text-secondary font-[family-name:var(--font-family-body)]">
                Your video, audio, and screen shares route through the fastest
                path on the planet. 300+ edge locations worldwide mean real-time
                speed that feels instant.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-8">
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={
                  isInView
                    ? { opacity: 1, scale: 1 }
                    : { opacity: 0, scale: 0.8 }
                }
                transition={{ duration: 0.5, delay: 0.4 }}
                className="flex items-center gap-3 rounded-full border border-emerald-500/20 bg-emerald-500/5 px-5 py-3"
              >
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-sm font-semibold text-rm-text font-[family-name:var(--font-family-body)]">
                  300+ Edge Nodes
                </span>
              </motion.div>
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={
                  isInView
                    ? { opacity: 1, scale: 1 }
                    : { opacity: 0, scale: 0.8 }
                }
                transition={{ duration: 0.5, delay: 0.5 }}
                className="flex items-center gap-3 rounded-full border border-rm-accent/20 bg-rm-accent/5 px-5 py-3"
              >
                <Globe2 className="h-4 w-4 text-rm-accent" />
                <span className="text-sm font-semibold text-rm-text font-[family-name:var(--font-family-body)]">
                  ≤18ms Latency
                </span>
              </motion.div>
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={
                  isInView
                    ? { opacity: 1, scale: 1 }
                    : { opacity: 0, scale: 0.8 }
                }
                transition={{ duration: 0.5, delay: 0.6 }}
                className="flex items-center gap-3 rounded-full border border-rm-accent/20 bg-rm-accent/5 px-5 py-3"
              >
                <span className="h-2.5 w-2.5 rounded-full bg-rm-accent" />
                <span className="text-sm font-semibold text-rm-text font-[family-name:var(--font-family-body)]">
                  Open Source
                </span>
              </motion.div>
            </div>
            <div className="pointer-events-none absolute left-1/2 top-1/2 h-96 w-96 -translate-x-1/2 -translate-y-1/2 rounded-full bg-rm-accent/5 blur-3xl transition-all duration-700 group-hover:bg-rm-accent/10" />
          </motion.div>
        </div>
      </div>
    </section>
  );
}

function HomePageCTA({
  joinRoom,
  room,
  setRoom,
}: {
  joinRoom: (e: React.FormEvent) => void;
  room: string;
  setRoom: (r: string) => void;
}) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });

  return (
    <section
      ref={ref}
      className="relative flex w-full flex-col items-center justify-center px-6 py-28 text-center sm:py-40"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={
          isInView ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.9 }
        }
        transition={{ duration: 0.5 }}
        className="relative z-10 mb-5 inline-flex items-center gap-2 rounded-full border border-rm-border bg-rm-bg-surface/60 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-rm-text-secondary backdrop-blur-sm"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
        <span className="font-[family-name:var(--font-family-body)]">
          Free forever
        </span>
      </motion.div>

      <motion.h2
        initial={{ opacity: 0, y: 20 }}
        animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
        transition={{ duration: 0.6, delay: 0.1 }}
        className="relative z-10 mb-8 max-w-2xl text-4xl font-normal leading-tight tracking-tight text-rm-text sm:text-5xl md:text-6xl font-[family-name:var(--font-family-display)]"
      >
        Your people are already{" "}
        <span className="italic text-rm-accent">here</span>
      </motion.h2>

      <motion.form
        initial={{ opacity: 0, y: 20 }}
        animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
        transition={{ duration: 0.6, delay: 0.2 }}
        onSubmit={joinRoom}
        className="group relative z-10 flex w-full max-w-lg flex-col gap-2 rounded-2xl border border-rm-border bg-rm-bg-surface/60 p-2 backdrop-blur-xl transition-all focus-within:border-rm-accent focus-within:shadow-lg focus-within:shadow-rm-accent/20 sm:flex-row"
      >
        <input
          type="text"
          value={room}
          onChange={(e) => setRoom(e.target.value)}
          placeholder="Enter room code or link..."
          spellCheck={false}
          autoComplete="off"
          className="h-full w-full rounded-xl bg-transparent px-4 py-3 text-base font-medium text-rm-text outline-none placeholder:text-rm-text-muted font-[family-name:var(--font-family-body)]"
        />
        <button
          type="submit"
          disabled={!room.trim()}
          className="group/btn flex items-center justify-center gap-2 rounded-xl bg-rm-accent px-6 py-3 font-semibold text-white transition-all hover:bg-rm-accent-hover disabled:opacity-50 font-[family-name:var(--font-family-body)]"
        >
          <span>Join Room</span>
          <ArrowRight className="h-4 w-4 transition-transform group-hover/btn:translate-x-1" />
        </button>
      </motion.form>

      <motion.p
        initial={{ opacity: 0 }}
        animate={isInView ? { opacity: 1 } : { opacity: 0 }}
        transition={{ duration: 0.6, delay: 0.3 }}
        className="relative z-10 mt-6 text-xs font-medium text-rm-text-muted font-[family-name:var(--font-family-body)]"
      >
        No credit card. No sign-up. Just share the link.
      </motion.p>
    </section>
  );
}

function HomePageFooter() {
  return (
    <footer className="relative z-10 w-full border-t border-rm-border bg-rm-bg-primary px-6 py-12 sm:px-10">
      <div className="mx-auto flex w-full max-w-7xl flex-col items-center gap-8 md:flex-row md:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-rm-bg-surface text-rm-text ring-1 ring-rm-border">
            <HomeIcon className="h-4 w-4" />
          </div>
          <span className="text-base font-semibold tracking-tight text-rm-text font-[family-name:var(--font-family-body)]">
            Ralph Meet
          </span>
        </div>
        <div className="flex items-center gap-6 text-sm text-rm-text-muted font-[family-name:var(--font-family-body)]">
          <a
            href="https://github.com/115jon/ralph-meet"
            target="_blank"
            rel="noreferrer"
            className="transition-colors hover:text-rm-text"
          >
            GitHub
          </a>
          <a
            href="https://github.com/115jon/ralph-meet/releases/latest"
            target="_blank"
            rel="noreferrer"
            className="transition-colors hover:text-rm-text"
          >
            Download
          </a>
        </div>
      </div>
    </footer>
  );
}

export default function HomePageClient() {
  const navigate = useNavigate();
  const [room, setRoom] = useState("");
  const [profileOpen, setProfileOpen] = useState(false);

  const createRoom = () => {
    const slug =
      Math.random().toString(36).substring(2, 8) +
      "-" +
      Math.random().toString(36).substring(2, 6);
    navigate({ to: "/room/$slug", params: { slug } });
  };

  const joinRoom = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = room.trim().toLowerCase().replace(/\s+/g, "-");
    if (trimmed) {
      navigate({ to: "/room/$slug", params: { slug: trimmed } });
    }
  };

  return (
    <div className="relative flex min-h-screen flex-col bg-rm-bg-primary">
      <HomePageHeader />
      <HomePageHero createRoom={createRoom} />
      <HomePageFeatures />
      <HomePageCTA joinRoom={joinRoom} room={room} setRoom={setRoom} />
      <HomePageFooter />
      <SettingsModal open={profileOpen} onClose={() => setProfileOpen(false)} />
    </div>
  );
}
