import { HomeIcon } from "@/components/chat/HomeIcon";
import { isWindows } from "@/lib/platform";
import { UserButton, useAuth } from "@kova/react";
import { useNavigate } from "@tanstack/react-router";
import { Icon } from "@/components/ui/icon";
import {
  motion,
  useInView,
  useReducedMotion,
  type Transition,
} from "framer-motion";
import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

const subscribeToStaticPlatform = () => () => {};
const getServerWindowsSnapshot = () => false;

const EASE: Transition = {
  duration: 0.55,
  ease: [0.16, 1, 0.3, 1],
};

interface DesktopRelease {
  tagName: string;
  name: string;
  downloadUrl: string;
  fileName: string;
  isLatest: boolean;
}

interface GithubReleaseAsset {
  name: string;
  browser_download_url: string;
}

interface GithubRelease {
  tag_name: string;
  name: string | null;
  assets?: GithubReleaseAsset[];
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

function isGithubRelease(value: unknown): value is GithubRelease {
  if (!value || typeof value !== "object") return false;
  return typeof Reflect.get(value, "tag_name") === "string";
}

function mapGithubReleases(payload: unknown): DesktopRelease[] {
  if (!Array.isArray(payload)) return [];
  return payload
    .filter(isGithubRelease)
    .map((release, index) => {
      const asset = release.assets?.find((item) => item.name.endsWith(".exe"));
      if (!asset) return null;
      return {
        tagName: release.tag_name,
        name: release.name || release.tag_name,
        downloadUrl: asset.browser_download_url,
        fileName: asset.name,
        isLatest: index === 0,
      };
    })
    .filter((release): release is DesktopRelease => release !== null);
}

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rm-accent";

function HomePageHeader() {
  const { isSignedIn } = useAuth();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const sentinel = document.getElementById("home-scroll-sentinel");
    if (!sentinel) return;
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[0];
      setScrolled(entry ? !entry.isIntersecting : false);
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 transition-[background-color,border-color,backdrop-filter] duration-300 ${
        scrolled
          ? "border-b border-rm-border bg-rm-bg-primary/88 backdrop-blur-xl"
          : "border-b border-transparent bg-transparent"
      }`}
    >
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-6 sm:px-10">
        <a
          href="#home-hero"
          className={`flex items-center gap-3 rounded-lg ${focusRing}`}
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-rm-bg-elevated text-rm-text ring-1 ring-rm-border">
            <HomeIcon className="h-4 w-4" />
          </div>
          <span className="text-base font-semibold tracking-tight text-rm-text font-[family-name:var(--font-family-body)]">
            Ralph Meet
          </span>
        </a>
        <nav aria-label="Account" className="flex items-center gap-4">
          {!isSignedIn ? (
            <a
              href="/sign-in"
              className={`rounded-full bg-rm-accent px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-rm-accent-hover active:scale-[0.98] ${focusRing}`}
            >
              Sign In
            </a>
          ) : (
            <div className="rounded-full bg-rm-bg-elevated p-1 ring-1 ring-rm-border">
              <UserButton
                afterSignOutUrl="/"
                size={32}
                appearance={{ variables: { colorPrimary: "#5865f2" } }}
              />
            </div>
          )}
        </nav>
      </div>
    </header>
  );
}

function HomePageHero({ createRoom }: { createRoom: () => void }) {
  const { isSignedIn } = useAuth();
  const reduceMotion = useReducedMotion();
  const isWindowsUser = useSyncExternalStore(
    subscribeToStaticPlatform,
    () => isWindows(),
    getServerWindowsSnapshot,
  );
  const [releases, setReleases] = useState<DesktopRelease[]>(FALLBACK_RELEASES);

  useEffect(() => {
    fetch("https://api.github.com/repos/115jon/ralph-meet/releases")
      .then((response) => response.json())
      .then((payload: unknown) => {
        const mapped = mapGithubReleases(payload);
        if (mapped.length > 0) setReleases(mapped);
      })
      .catch(() => {});
  }, []);

  const latestRelease = releases[0];
  const instant = reduceMotion ? { duration: 0 } : EASE;

  return (
    <section
      id="home-hero"
      className="relative flex min-h-[100dvh] w-full flex-col overflow-hidden bg-rm-bg-primary pt-16"
    >
      {!reduceMotion ? (
        <video
          autoPlay
          loop
          muted
          playsInline
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-[0.18]"
        >
          <source
            src="https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260319_015952_e1deeb12-8fb7-4071-a42a-60779fc64ab6.mp4"
            type="video/mp4"
          />
        </video>
      ) : null}

      <div className="absolute inset-0 bg-gradient-to-b from-rm-bg-primary via-rm-bg-primary/70 to-rm-bg-primary" />

      <div className="relative z-10 mx-auto flex w-full max-w-7xl flex-1 flex-col justify-center px-6 pb-10 pt-10 sm:px-10 lg:grid lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] lg:items-end lg:gap-12 lg:pb-14 lg:pt-20">
        <div className="max-w-xl">
          <motion.h1
            initial={reduceMotion ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...instant, delay: reduceMotion ? 0 : 0.05 }}
            className="mb-5 text-balance text-5xl font-normal leading-[1.05] tracking-tight text-rm-text sm:text-6xl lg:text-7xl font-[family-name:var(--font-family-display)]"
          >
            Hang out in <em className="italic text-rm-accent">real time</em>
          </motion.h1>

          <motion.p
            initial={reduceMotion ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...instant, delay: reduceMotion ? 0 : 0.12 }}
            className="mb-8 max-w-[36ch] text-pretty text-base leading-relaxed text-rm-text-secondary sm:text-lg font-[family-name:var(--font-family-body)]"
          >
            Voice rooms, video, and chat on Cloudflare&apos;s edge. Share a
            link.
          </motion.p>

          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...instant, delay: reduceMotion ? 0 : 0.18 }}
            className="flex flex-col items-start gap-3 sm:flex-row sm:items-center"
          >
            <button
              type="button"
              onClick={createRoom}
              className={`flex items-center gap-2 rounded-full bg-rm-accent px-6 py-3 text-sm font-semibold text-white shadow-[0_10px_24px_-12px] shadow-rm-accent transition-colors hover:bg-rm-accent-hover active:scale-[0.98] font-[family-name:var(--font-family-body)] ${focusRing}`}
            >
              Start a room
            </button>

            {isSignedIn ? (
              <a
                href="/chat"
                className={`flex items-center gap-2 rounded-full border border-rm-border bg-rm-bg-elevated/80 px-6 py-3 text-sm font-semibold text-rm-text transition-colors hover:bg-rm-bg-elevated active:scale-[0.98] font-[family-name:var(--font-family-body)] ${focusRing}`}
              >
                <Icon name="chat" size="sm" />
                Open chat
              </a>
            ) : isWindowsUser ? (
              <a
                href={latestRelease.downloadUrl}
                className={`flex items-center gap-2 rounded-full border border-rm-border bg-rm-bg-elevated/80 px-6 py-3 text-sm font-semibold text-rm-text transition-colors hover:bg-rm-bg-elevated active:scale-[0.98] font-[family-name:var(--font-family-body)] ${focusRing}`}
              >
                <Icon name="download" size="sm" />
                Download
              </a>
            ) : null}
          </motion.div>
        </div>

        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 28 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...instant, delay: reduceMotion ? 0 : 0.22 }}
          className="mt-8 w-full lg:mt-0"
        >
          <div className="max-h-[28vh] overflow-hidden rounded-xl border border-rm-border bg-rm-bg-elevated shadow-[0_24px_80px_-32px_rgba(0,0,0,0.85)] sm:max-h-[36vh] lg:max-h-none">
            <img
              src="/screenshots/desktop-app.png"
              alt="Ralph Meet desktop app with a live voice room and chat sidebar"
              width={1093}
              height={780}
              fetchPriority="high"
              decoding="async"
              className="aspect-[1093/780] w-full object-cover object-top"
            />
          </div>
        </motion.div>
      </div>
    </section>
  );
}

function HomePageFeatures() {
  const ref = useRef<HTMLElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-80px" });
  const reduceMotion = useReducedMotion();
  const instant = reduceMotion ? { duration: 0 } : EASE;

  return (
    <section
      ref={ref}
      className="relative w-full border-t border-rm-border bg-rm-bg-primary px-6 py-24 sm:px-10 md:py-32"
    >
      <div className="mx-auto w-full max-w-7xl">
        <motion.h2
          initial={reduceMotion ? false : { opacity: 0, y: 16 }}
          animate={isInView ? { opacity: 1, y: 0 } : undefined}
          transition={instant}
          className="mb-16 max-w-2xl text-balance text-4xl font-normal tracking-tight text-rm-text sm:text-5xl md:text-6xl font-[family-name:var(--font-family-display)]"
        >
          Rooms you can drop into
        </motion.h2>

        <motion.article
          initial={reduceMotion ? false : { opacity: 0, y: 24 }}
          animate={isInView ? { opacity: 1, y: 0 } : undefined}
          transition={{ ...instant, delay: reduceMotion ? 0 : 0.08 }}
          className="grid items-center gap-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-16"
        >
          <div>
            <h3 className="mb-3 text-3xl font-normal tracking-tight text-rm-text sm:text-4xl font-[family-name:var(--font-family-display)]">
              Voice that stays open
            </h3>
            <p className="max-w-[42ch] text-base leading-relaxed text-rm-text-secondary font-[family-name:var(--font-family-body)]">
              Friends see you&apos;re around and hop in. No calendar, no lobby,
              no waiting for someone to start the call.
            </p>
          </div>
          <div className="overflow-hidden rounded-xl border border-rm-border bg-rm-bg-elevated">
            <img
              src="/screenshots/voice-room.png"
              alt="Two people in a Ralph Meet voice room with live tiles and controls"
              width={1866}
              height={955}
              loading="lazy"
              decoding="async"
              className="aspect-[1866/955] w-full object-cover object-top"
            />
          </div>
        </motion.article>

        <motion.article
          initial={reduceMotion ? false : { opacity: 0, y: 24 }}
          animate={isInView ? { opacity: 1, y: 0 } : undefined}
          transition={{ ...instant, delay: reduceMotion ? 0 : 0.14 }}
          className="mt-24"
        >
          <h3 className="mb-3 text-3xl font-normal tracking-tight text-rm-text sm:text-4xl font-[family-name:var(--font-family-display)]">
            Chat that keeps the thread
          </h3>
          <p className="mb-8 max-w-[46ch] text-base leading-relaxed text-rm-text-secondary font-[family-name:var(--font-family-body)]">
            Channels for topics, GIFs, files, and the leftover jokes from voice.
            The hangout continues after you mute.
          </p>
          <div className="overflow-hidden rounded-xl border border-rm-border bg-rm-bg-elevated">
            <img
              src="/screenshots/chat-ui.png"
              alt="Ralph Meet chat channel with messages, GIFs, and a composer"
              width={1862}
              height={954}
              loading="lazy"
              decoding="async"
              className="aspect-[1862/954] w-full object-cover object-top"
            />
          </div>
        </motion.article>

        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 16 }}
          animate={isInView ? { opacity: 1, y: 0 } : undefined}
          transition={{ ...instant, delay: reduceMotion ? 0 : 0.2 }}
          className="mt-20 grid gap-8 border-t border-rm-border pt-10 sm:grid-cols-2"
        >
          <p className="max-w-[36ch] text-lg leading-relaxed text-rm-text font-[family-name:var(--font-family-body)]">
            Routed through Cloudflare&apos;s global edge so the path stays
            short, wherever people join from.
          </p>
          <ul className="flex flex-col gap-3 text-sm text-rm-text-secondary font-[family-name:var(--font-family-body)] sm:items-end">
            <li>300+ Cloudflare edge locations</li>
            <li>Open source on GitHub</li>
          </ul>
        </motion.div>
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
  const ref = useRef<HTMLElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-80px" });
  const reduceMotion = useReducedMotion();
  const roomFieldId = useId();
  const instant = reduceMotion ? { duration: 0 } : EASE;

  return (
    <section
      ref={ref}
      className="relative w-full border-t border-rm-border px-6 py-24 sm:px-10 sm:py-32"
    >
      <div className="mx-auto w-full max-w-7xl">
        <motion.h2
          initial={reduceMotion ? false : { opacity: 0, y: 16 }}
          animate={isInView ? { opacity: 1, y: 0 } : undefined}
          transition={instant}
          className="mb-4 max-w-xl text-4xl font-normal tracking-tight text-rm-text sm:text-5xl md:text-6xl font-[family-name:var(--font-family-display)]"
        >
          Already have a room?
        </motion.h2>
        <motion.p
          initial={reduceMotion ? false : { opacity: 0, y: 16 }}
          animate={isInView ? { opacity: 1, y: 0 } : undefined}
          transition={{ ...instant, delay: reduceMotion ? 0 : 0.08 }}
          className="mb-8 max-w-[40ch] text-base text-rm-text-secondary font-[family-name:var(--font-family-body)]"
        >
          Paste the code or link. No account required.
        </motion.p>

        <motion.form
          initial={reduceMotion ? false : { opacity: 0, y: 16 }}
          animate={isInView ? { opacity: 1, y: 0 } : undefined}
          transition={{ ...instant, delay: reduceMotion ? 0 : 0.12 }}
          onSubmit={joinRoom}
          className={`flex w-full max-w-lg flex-col gap-2 rounded-xl border border-rm-border bg-rm-bg-elevated p-2 focus-within:border-rm-accent sm:flex-row ${focusRing}`}
        >
          <label htmlFor={roomFieldId} className="sr-only">
            Room code or link
          </label>
          <input
            id={roomFieldId}
            type="text"
            value={room}
            onChange={(e) => setRoom(e.target.value)}
            placeholder="Room code or link"
            spellCheck={false}
            autoComplete="off"
            className="h-full w-full rounded-lg bg-transparent px-4 py-3 text-base font-medium text-rm-text outline-none placeholder:text-rm-text-muted font-[family-name:var(--font-family-body)]"
          />
          <button
            type="submit"
            disabled={!room.trim()}
            className={`flex items-center justify-center gap-2 rounded-lg bg-rm-accent px-6 py-3 font-semibold text-white transition-colors hover:bg-rm-accent-hover disabled:cursor-not-allowed disabled:opacity-50 font-[family-name:var(--font-family-body)] ${focusRing}`}
          >
            <span>Join room</span>
            <Icon name="arrowRight" size="sm" />
          </button>
        </motion.form>
      </div>
    </section>
  );
}

function HomePageFooter() {
  return (
    <footer className="relative z-10 w-full border-t border-rm-border bg-rm-bg-primary px-6 py-10 sm:px-10">
      <div className="mx-auto flex w-full max-w-7xl flex-col items-start gap-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-rm-bg-elevated text-rm-text ring-1 ring-rm-border">
            <HomeIcon className="h-4 w-4" />
          </div>
          <span className="text-sm font-medium text-rm-text font-[family-name:var(--font-family-body)]">
            Ralph Meet
          </span>
        </div>
        <div className="flex items-center gap-6 text-sm text-rm-text-muted font-[family-name:var(--font-family-body)]">
          <a
            href="https://github.com/115jon/ralph-meet"
            target="_blank"
            rel="noreferrer"
            className={`transition-colors hover:text-rm-text ${focusRing} rounded-sm`}
          >
            GitHub
          </a>
          <a
            href="https://github.com/115jon/ralph-meet/releases/latest"
            target="_blank"
            rel="noreferrer"
            className={`transition-colors hover:text-rm-text ${focusRing} rounded-sm`}
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
    <div className="relative flex min-h-[100dvh] flex-col bg-rm-bg-primary">
      <a
        href="#home-hero"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-rm-accent focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-white"
      >
        Skip to content
      </a>
      <div
        id="home-scroll-sentinel"
        className="pointer-events-none h-5 w-full"
        aria-hidden="true"
      />
      <HomePageHeader />
      <main>
        <HomePageHero createRoom={createRoom} />
        <HomePageFeatures />
        <HomePageCTA joinRoom={joinRoom} room={room} setRoom={setRoom} />
      </main>
      <HomePageFooter />
    </div>
  );
}
