import SettingsModal from "@/components/chat/SettingsModal";
import { HomeIcon } from "@/components/chat/HomeIcon";
import { UserButton, useAuth } from "@kova/react";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowRight,
  Globe2,
  MessageSquare,
  Zap,
  ChevronDown,
  ChevronUp,
  Download,
  Hash,
  Volume2,
  Mic,
  MicOff,
  Video,
  VideoOff,
  Plus,
  Smile,
  Pin,
  Bell,
  Users,
  Search,
  Settings,
  Headphones,
  Monitor,
  PhoneOff,
  Sparkles,
  ShieldCheck,
  Paperclip,
  Send,
} from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { isWindows } from "@/lib/platform";

function HomePageHeader() {
  const { isSignedIn } = useAuth();
  return (
    <header className="fixed top-0 left-0 right-0 z-50 mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-6 py-3 sm:px-10 bg-rm-bg-primary/40 border-b border-rm-border backdrop-blur-md">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-rm-bg-surface text-rm-text ring-1 ring-rm-border shadow-xs">
          <HomeIcon className="h-5 w-5" />
        </div>
        <span className="text-lg font-bold tracking-tight text-rm-text">Ralph Meet</span>
      </div>
      <div className="flex items-center gap-4">
        {!isSignedIn ? (
          <a
            href="/sign-in"
            id="nav-sign-in"
            className="group relative overflow-hidden rounded-full bg-rm-accent hover:bg-rm-accent-hover px-5 py-1.5 text-sm font-bold text-white shadow-md transition-all duration-300 hover:scale-105 active:scale-95"
          >
            <span className="relative z-10">Sign In</span>
          </a>
        ) : (
          <div className="rounded-full bg-rm-bg-surface/50 p-1 shadow-md ring-1 ring-rm-border backdrop-blur-xl transition-all hover:bg-rm-bg-elevated">
            <UserButton afterSignOutUrl="/" size={32} appearance={{ variables: { colorPrimary: "#5865f2" } }} />
          </div>
        )}
      </div>
    </header>
  );
}

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
    downloadUrl: "https://github.com/115jon/ralph-meet/releases/download/v1.9.0/RalphMeetSetup.exe",
    fileName: "RalphMeetSetup.exe",
    isLatest: true,
  },
  {
    tagName: "v1.8.0",
    name: "v1.8.0",
    downloadUrl: "https://github.com/115jon/ralph-meet/releases/download/v1.8.0/Ralph.Meet_1.8.0_x64-setup.exe",
    fileName: "Ralph.Meet_1.8.0_x64-setup.exe",
    isLatest: false,
  },
  {
    tagName: "v1.7.0",
    name: "v1.7.0",
    downloadUrl: "https://github.com/115jon/ralph-meet/releases/download/v1.7.0/Ralph.Meet_1.7.0_x64-setup.exe",
    fileName: "Ralph.Meet_1.7.0_x64-setup.exe",
    isLatest: false,
  },
  {
    tagName: "v1.6.0",
    name: "v1.6.0",
    downloadUrl: "https://github.com/115jon/ralph-meet/releases/download/v1.6.0/Ralph.Meet_1.6.0_x64-setup.exe",
    fileName: "Ralph.Meet_1.6.0_x64-setup.exe",
    isLatest: false,
  },
];

function HomePageHero({ createRoom }: { createRoom: () => void }) {
  const navigate = useNavigate();
  const { isSignedIn } = useAuth();
  const [isWindowsUser, setIsWindowsUser] = useState(false);
  const [releasesExpanded, setReleasesExpanded] = useState(false);
  const [releases, setReleases] = useState<DesktopRelease[]>(FALLBACK_RELEASES);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setIsWindowsUser(isWindows());
  }, []);

  useEffect(() => {
    let isMounted = true;
    async function fetchReleases() {
      try {
        const res = await fetch("https://api.github.com/repos/115jon/ralph-meet/releases");
        if (!res.ok) return;
        const data = await res.json();
        if (!Array.isArray(data) || data.length === 0) return;

        const fetched: DesktopRelease[] = [];
        let latestFound = false;

        for (const rel of data) {
          if (rel.draft) continue;
          const tagName = rel.tag_name || rel.name || "";
          if (!tagName) continue;

          const exeAsset = rel.assets?.find(
            (a: any) => typeof a.name === "string" && a.name.toLowerCase().endsWith(".exe")
          );
          const downloadUrl = exeAsset
            ? exeAsset.browser_download_url
            : `https://github.com/115jon/ralph-meet/releases/download/${tagName}/RalphMeetSetup.exe`;
          const fileName = exeAsset ? exeAsset.name : `${tagName}-setup.exe`;

          const isLatest = !latestFound && !rel.prerelease;
          if (isLatest) latestFound = true;

          fetched.push({
            tagName,
            name: rel.name || tagName,
            downloadUrl,
            fileName,
            isLatest,
          });

          if (fetched.length >= 5) break;
        }

        if (fetched.length > 0 && isMounted) {
          if (!latestFound && fetched[0]) {
            fetched[0].isLatest = true;
          }
          setReleases(fetched);
        }
      } catch (err) {
        console.warn("Failed to auto-fetch desktop releases from GitHub API:", err);
      }
    }
    fetchReleases();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setReleasesExpanded(false);
      }
    }
    if (releasesExpanded) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [releasesExpanded]);

  const latestRelease = releases.find((r) => r.isLatest) || releases[0] || FALLBACK_RELEASES[0];

  return (
    <section className="mx-auto flex min-h-[90dvh] w-full max-w-7xl flex-col items-center justify-between gap-12 px-6 pb-12 pt-28 lg:flex-row lg:px-10">
      {/* Left: Content */}
      <div className="flex flex-col items-center text-center lg:items-start lg:text-left lg:max-w-xl animate-fade-in-up">
        <h1 className="mb-6 text-4xl font-extrabold uppercase leading-[1.05] tracking-tight text-rm-text drop-shadow-[0_4px_20px_rgba(0,0,0,0.5)] sm:text-5xl md:text-6xl lg:text-7xl">
          Imagine a <br />
          <span className="bg-linear-to-r from-[var(--rm-accent)] to-[var(--rm-accent)] bg-clip-text text-transparent">
            better place
          </span>
        </h1>

        <p className="mb-8 text-base font-medium leading-relaxed text-rm-text-secondary max-w-[45ch] lg:max-w-none" style={{ animationDelay: "150ms" }}>
          An invite-only space to hang out with friends, collaborate on code, or chat with your community. Real-time and secure.
        </p>

        <div className="flex w-full max-w-2xl flex-col items-stretch gap-3.5 sm:flex-row sm:items-center sm:justify-center lg:justify-start" style={{ animationDelay: "300ms" }}>
          {!isWindowsUser ? (
            <>
              <button
                onClick={createRoom}
                id="hero-try-free"
                className="group relative flex w-full shrink-0 flex-col items-center justify-center overflow-hidden rounded-full bg-rm-accent hover:bg-rm-accent-hover text-white px-7 py-3 shadow-lg shadow-rm-accent/20 transition-all duration-300 hover:scale-[1.02] active:scale-[0.98] sm:w-auto cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <Zap className="h-4 w-4 shrink-0 transition-transform duration-300 group-hover:scale-110 text-white" />
                  <span className="relative z-10 whitespace-nowrap text-base font-bold text-white">
                    Try It Free
                  </span>
                </span>
                <span className="mt-0.5 text-[9px] font-bold text-white/70 tracking-wider uppercase">
                  No sign-up needed
                </span>
              </button>

              <a
                href={isSignedIn ? "/chat" : "/sign-in"}
                id="hero-open-chat-web"
                className="group relative flex w-full shrink-0 items-center justify-center gap-2 overflow-hidden rounded-full bg-rm-bg-surface/80 px-6 py-4.5 text-base font-bold text-rm-text shadow-md ring-1 ring-rm-border backdrop-blur-xl transition-all duration-300 hover:bg-rm-bg-elevated hover:ring-rm-border/80 active:scale-[0.98] sm:w-auto cursor-pointer"
              >
                <MessageSquare className="h-4 w-4 transition-transform duration-300 group-hover:scale-110" />
                <span className="relative z-10 whitespace-nowrap">Open Web Chat</span>
              </a>
            </>
          ) : (
            <>
              <button
                onClick={createRoom}
                id="hero-try-free"
                className="group relative flex w-full shrink-0 flex-col items-center justify-center overflow-hidden rounded-full bg-rm-accent hover:bg-rm-accent-hover text-white px-7 py-3 shadow-lg shadow-rm-accent/20 transition-all duration-300 hover:scale-[1.02] active:scale-[0.98] sm:w-auto cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <Zap className="h-4 w-4 shrink-0 transition-transform duration-300 group-hover:scale-110 text-white" />
                  <span className="relative z-10 whitespace-nowrap text-base font-bold text-white">
                    Try It Free
                  </span>
                </span>
                <span className="mt-0.5 text-[9px] font-bold text-white/70 tracking-wider uppercase">
                  No sign-up needed
                </span>
              </button>

              {/* Desktop Download Button - Hidden on Mobile Screens */}
              <a
                href={latestRelease.downloadUrl}
                id="hero-download-win"
                title={`Download ${latestRelease.tagName}`}
                className="group relative hidden md:flex w-full shrink-0 items-center justify-center gap-2 overflow-hidden rounded-full bg-rm-bg-surface/80 px-6 py-4.5 text-base font-bold text-rm-text shadow-md ring-1 ring-rm-border backdrop-blur-xl transition-all duration-300 hover:bg-rm-bg-elevated hover:ring-rm-border/80 active:scale-[0.98] sm:w-auto cursor-pointer"
              >
                <svg className="h-4 w-4 fill-current transition-transform duration-300 group-hover:scale-110 text-rm-text" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path d="M0 3.449L9.75 2.1v9.45H0V3.449zM0 12.45h9.75v9.45L0 20.551v-8.1zM10.95 1.95L24 0v11.55H10.95V1.95zM10.95 12.45H24v11.55l-13.05-1.95v-9.6z"/>
                </svg>
                <span className="relative z-10 whitespace-nowrap">Download for Windows</span>
              </a>

              {/* Mobile Fallback: Open Web Chat */}
              <a
                href={isSignedIn ? "/chat" : "/sign-in"}
                id="hero-open-chat-mobile"
                className="group relative flex md:hidden w-full shrink-0 items-center justify-center gap-2 overflow-hidden rounded-full bg-rm-bg-surface/80 px-6 py-4.5 text-base font-bold text-rm-text shadow-md ring-1 ring-rm-border backdrop-blur-xl transition-all duration-300 hover:bg-rm-bg-elevated hover:ring-rm-border/80 active:scale-[0.98] sm:w-auto cursor-pointer"
              >
                <MessageSquare className="h-4 w-4 transition-transform duration-300 group-hover:scale-110" />
                <span className="relative z-10 whitespace-nowrap">Open Web Chat</span>
              </a>

              {isSignedIn && (
                <button
                  onClick={() => navigate({ to: "/chat" })}
                  id="hero-open-chat"
                  className="group relative hidden md:flex w-full shrink-0 items-center justify-center gap-2 overflow-hidden rounded-full bg-rm-bg-surface/80 px-6 py-4.5 text-base font-bold text-rm-text shadow-md ring-1 ring-rm-border backdrop-blur-xl transition-all duration-300 hover:bg-rm-bg-elevated hover:ring-rm-border/80 active:scale-[0.98] sm:w-auto cursor-pointer"
                >
                  <MessageSquare className="h-4 w-4 transition-transform duration-300 group-hover:scale-110" />
                  <span className="relative z-10 whitespace-nowrap">Open Chat</span>
                </button>
              )}
            </>
          )}
        </div>

        <div className="mt-8 flex flex-col items-center lg:items-start gap-4 text-xs font-medium text-rm-text-muted animate-fade-in-up" style={{ animationDelay: "400ms" }}>
          <div className="flex flex-col items-center lg:items-start gap-1">
            {isWindowsUser ? (
              <p className="hidden md:block">Instant rooms. Desktop client available for Windows (x64).</p>
            ) : (
              <p className="hidden md:block">Instant rooms. Desktop client available for Windows (x64) - macOS & Linux coming soon.</p>
            )}
            <p className="block md:hidden">Instant rooms and real-time chat right in your browser.</p>
            {!isSignedIn && (
              <p className="text-rm-text-secondary">
                Want persistent chats?{" "}
                <a
                  href="/sign-in"
                  id="hero-link-sign-in"
                  className="font-semibold text-rm-accent underline underline-offset-2 transition-colors hover:text-rm-accent-hover"
                >
                  Sign in to unlock Open Chat
                </a>
              </p>
            )}
          </div>

          {/* Desktop Releases Dropdown - Hidden on Mobile Screens */}
          <div className="relative hidden md:block" ref={dropdownRef}>
            <button
              onClick={() => setReleasesExpanded(!releasesExpanded)}
              className="flex items-center gap-1.5 rounded-xl bg-rm-bg-surface/80 px-3.5 py-2 text-xs font-semibold text-rm-text-secondary ring-1 ring-rm-border backdrop-blur-md transition-all hover:bg-rm-bg-elevated hover:text-rm-text hover:ring-rm-border/80 active:scale-[0.98] cursor-pointer"
            >
              <span>Desktop Releases</span>
              {releasesExpanded ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
            </button>

            {releasesExpanded && (
              <div className="absolute left-0 mt-2.5 z-30 w-72 origin-top-left rounded-2xl border border-rm-border bg-rm-bg-surface p-4 shadow-2xl backdrop-blur-xl animate-fade-in-up">
                <div className="mb-3 flex items-center justify-between border-b border-rm-border/60 pb-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-rm-text-secondary">Windows x64 Releases</span>
                  <span className="rounded-full bg-rm-bg-primary px-2 py-0.5 text-[10px] font-medium text-rm-text-muted">Direct Links</span>
                </div>
                <ul className="flex flex-col gap-2.5">
                  {releases.map((rel) => (
                    <li
                      key={rel.tagName}
                      className={`flex items-center justify-between rounded-xl p-2.5 transition-colors ${
                        rel.isLatest
                          ? "bg-rm-bg-primary/80 hover:bg-rm-bg-hover"
                          : "bg-rm-bg-primary/40 hover:bg-rm-bg-hover"
                      }`}
                    >
                      <div className="flex flex-col gap-0.5 min-w-0 pr-2">
                        <span
                          className={`font-bold text-xs truncate ${
                            rel.isLatest ? "text-rm-text" : "text-rm-text-secondary"
                          }`}
                        >
                          {rel.tagName} {rel.isLatest && "(Latest)"}
                        </span>
                        <span className="text-[10px] text-rm-text-muted truncate">
                          {rel.fileName}
                        </span>
                      </div>
                      <a
                        href={rel.downloadUrl}
                        className={`rounded-lg p-2 transition-colors shrink-0 ${
                          rel.isLatest
                            ? "bg-rm-accent/20 text-rm-accent hover:bg-rm-accent/30"
                            : "bg-rm-bg-surface text-rm-text-muted hover:bg-rm-bg-hover hover:text-rm-text ring-1 ring-rm-border"
                        }`}
                        title={`Download ${rel.tagName}`}
                      >
                        <Download className="h-4 w-4" />
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Right: Premium Interactive Dual Workspace Showcase */}
      <HeroInteractiveWorkspace />
    </section>
  );
}

function HeroInteractiveWorkspace() {
  const [activeTab, setActiveTab] = useState<"voice" | "chat">("voice");

  return (
    <div className="relative flex w-full flex-1 items-center justify-center lg:w-[54%] animate-fade-in-up mt-8 lg:mt-0" style={{ animationDelay: "450ms" }}>
      {/* Underlay glow */}
      <div className="absolute h-80 w-80 rounded-full bg-rm-accent/20 blur-[120px] pointer-events-none" />

      {/* Main Workspace Frame - 1-to-1 App Replica */}
      <div className="relative w-full max-w-[660px] overflow-hidden rounded-2xl border border-rm-border bg-rm-bg-primary text-rm-text shadow-2xl backdrop-blur-xl transition-all duration-300 hover:border-rm-accent/30 flex flex-col h-[400px] sm:h-[430px] select-none">
        {/* Window Header Bar */}
        <div className="flex h-10 items-center justify-between border-b border-rm-border/60 bg-rm-bg-elevated px-3 sm:px-4 shrink-0">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              <div className="h-3 w-3 rounded-full bg-[#ff5f56]" />
              <div className="h-3 w-3 rounded-full bg-[#ffbd2e]" />
              <div className="h-3 w-3 rounded-full bg-[#27c93f]" />
            </div>
          </div>

          {/* Interactive Mode Switcher */}
          <div className="flex items-center rounded-xl bg-rm-bg-surface/60 p-1 ring-1 ring-rm-border">
            <button
              type="button"
              onClick={() => setActiveTab("voice")}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-bold transition-all cursor-pointer ${
                activeTab === "voice"
                  ? "bg-rm-accent text-white shadow-md"
                  : "text-rm-text-muted hover:text-rm-text"
              }`}
            >
              <Volume2 className="h-3.5 w-3.5" />
              <span>Voice Room</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("chat")}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-bold transition-all cursor-pointer ${
                activeTab === "chat"
                  ? "bg-rm-accent text-white shadow-md"
                  : "text-rm-text-muted hover:text-rm-text"
              }`}
            >
              <MessageSquare className="h-3.5 w-3.5" />
              <span>Text Chat</span>
            </button>
          </div>

          {/* Status Telemetry */}
          <div className="hidden sm:flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-bold text-emerald-400 ring-1 ring-emerald-500/20">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span>SFU 18ms</span>
          </div>
        </div>

        {/* 1-to-1 App Interface Split View */}
        <div className="flex flex-1 overflow-hidden">
          {/* Authentic Left App Sidebar (Hidden on tight mobile screens) */}
          <div className="hidden sm:flex w-48 shrink-0 border-r border-rm-border/60 bg-rm-bg-sidebar flex-col justify-between select-none">
            <div className="flex flex-col">
              {/* Server Header */}
              <div className="flex h-11 items-center justify-between border-b border-rm-border/50 px-3">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-gradient-to-tr from-rm-accent to-purple-500 font-bold text-white text-[10px]">
                    R
                  </div>
                  <span className="font-bold text-[12px] text-rm-text truncate">Ralph Space</span>
                </div>
                <ChevronDown className="h-3.5 w-3.5 text-rm-text-muted shrink-0" />
              </div>

              {/* Channels */}
              <div className="p-2 flex flex-col gap-2.5 text-[11px]">
                <div className="flex flex-col gap-0.5">
                  <span className="px-1 py-0.5 text-[9px] font-extrabold uppercase tracking-wider text-rm-text-muted">Text</span>
                  <button
                    type="button"
                    onClick={() => setActiveTab("chat")}
                    className={`flex w-full items-center gap-2 rounded border-0 bg-transparent px-2 py-1 text-left cursor-pointer transition-colors ${
                      activeTab === "chat" ? "bg-rm-accent/20 font-bold text-rm-accent" : "text-rm-text-secondary hover:bg-rm-bg-hover"
                    }`}
                    aria-label="Open general chat"
                  >
                    <Hash className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">general</span>
                  </button>
                </div>

                <div className="flex flex-col gap-0.5">
                  <span className="px-1 py-0.5 text-[9px] font-extrabold uppercase tracking-wider text-rm-text-muted">Voice</span>
                  <button
                    type="button"
                    onClick={() => setActiveTab("voice")}
                    className={`flex w-full items-center justify-between rounded border-0 bg-transparent px-2 py-1 text-left cursor-pointer transition-colors ${
                      activeTab === "voice" ? "bg-emerald-500/20 font-bold text-emerald-400" : "text-rm-text-secondary hover:bg-rm-bg-hover"
                    }`}
                    aria-label="Open Lounge Voice"
                  >
                    <div className="flex items-center gap-2 truncate">
                      <Volume2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                      <span className="truncate">Lounge Voice</span>
                    </div>
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  </button>
                </div>
              </div>
            </div>

            {/* User Control Panel at Bottom Left */}
            <div className="flex h-12 items-center justify-between border-t border-rm-border/60 bg-rm-bg-elevated px-2.5">
              <div className="flex items-center gap-2 min-w-0">
                <div className="relative shrink-0">
                  <div className="h-7 w-7 rounded-full bg-gradient-to-tr from-rm-accent to-indigo-500 flex items-center justify-center font-bold text-white text-[10px]">
                    J
                  </div>
                  <span className="absolute bottom-0 right-0 h-2 w-2 rounded-full bg-emerald-500 ring-1 ring-rm-bg-elevated" />
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="font-bold text-[11px] text-rm-text truncate leading-tight">Jonathan</span>
                  <span className="text-[9px] text-emerald-400 leading-tight">Online</span>
                </div>
              </div>
              <div className="flex items-center gap-1 text-rm-text-muted">
                <Mic className="h-3.5 w-3.5 hover:text-rm-text cursor-pointer" />
                <Settings className="h-3.5 w-3.5 hover:text-rm-text cursor-pointer" />
              </div>
            </div>
          </div>

          {/* Right Workspace Main Content Area */}
          <div className="relative flex-1 bg-rm-bg-primary overflow-hidden flex flex-col min-w-0">
            {activeTab === "voice" ? (
              <div className="flex flex-1 flex-col justify-between p-3 animate-fade-in-up" style={{ animationDuration: "250ms" }}>
                {/* Real Voice Participant Grid */}
                <div className="grid grid-cols-2 gap-2 flex-1">
                  {/* Tile 1: Active Speaker */}
                  <div className="relative flex flex-col items-center justify-center rounded-xl bg-rm-bg-surface border border-rm-accent/60 ring-2 ring-rm-accent/50 overflow-hidden shadow-lg p-2.5">
                    <div className="relative z-10 flex flex-col items-center">
                      <div className="relative">
                        <span className="absolute -inset-1.5 rounded-full bg-rm-accent/30 animate-ping opacity-75" />
                        <div className="h-10 w-10 sm:h-12 sm:w-12 rounded-full bg-gradient-to-tr from-rm-accent to-indigo-500 flex items-center justify-center font-bold text-white text-xs sm:text-sm shadow-xl ring-2 ring-rm-accent">
                          DK
                        </div>
                      </div>
                      <span className="mt-1.5 text-[11px] font-bold text-rm-text">Devin K.</span>
                    </div>
                    <div className="absolute bottom-1.5 left-1.5 flex items-center gap-1 rounded-md bg-rm-bg-elevated/90 backdrop-blur-md px-1.5 py-0.5 ring-1 ring-rm-border">
                      <Video className="h-2.5 w-2.5 text-rm-accent" />
                      <span className="text-[9px] sm:text-[10px] font-semibold text-rm-text">Devin (HD Video)</span>
                    </div>
                  </div>

                  {/* Tile 2: Sarah Chen */}
                  <div className="relative flex flex-col items-center justify-center rounded-xl bg-rm-bg-surface border border-emerald-500/50 ring-2 ring-emerald-500/60 overflow-hidden shadow-lg p-2.5">
                    <div className="relative z-10 flex flex-col items-center">
                      <div className="relative">
                        <span className="absolute -inset-1.5 rounded-full bg-emerald-500/30 animate-ping opacity-75" />
                        <div className="h-10 w-10 sm:h-12 sm:w-12 rounded-full bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center font-bold text-white text-xs sm:text-sm shadow-xl ring-2 ring-emerald-400">
                          SC
                        </div>
                      </div>
                      <span className="mt-1.5 text-[11px] font-bold text-rm-text">Sarah Chen</span>
                    </div>
                    <div className="absolute bottom-1.5 left-1.5 flex items-center gap-1 rounded-md bg-rm-bg-elevated/90 backdrop-blur-md px-1.5 py-0.5 ring-1 ring-rm-border">
                      <Video className="h-2.5 w-2.5 text-emerald-400" />
                      <span className="text-[9px] sm:text-[10px] font-semibold text-rm-text">Sarah Chen</span>
                    </div>
                  </div>

                  {/* Tile 3: Marcus R. */}
                  <div className="relative flex flex-col items-center justify-center rounded-xl bg-rm-bg-surface border border-rm-border overflow-hidden shadow-md p-2.5">
                    <div className="h-9 w-9 sm:h-11 sm:w-11 rounded-full bg-gradient-to-tr from-purple-600 to-pink-600 flex items-center justify-center font-bold text-white text-xs shadow-md">
                      MR
                    </div>
                    <span className="mt-1.5 text-[11px] font-medium text-rm-text-secondary">Marcus R.</span>
                    <div className="absolute top-1.5 right-1.5 rounded-full bg-red-500/20 p-1 ring-1 ring-red-500/40">
                      <MicOff className="h-2.5 w-2.5 text-red-400" />
                    </div>
                  </div>

                  {/* Tile 4: Elena V. */}
                  <div className="relative flex flex-col items-center justify-center rounded-xl bg-rm-bg-surface border border-emerald-500/40 ring-1 ring-emerald-500/30 overflow-hidden shadow-md p-2.5">
                    <div className="relative">
                      <span className="absolute -inset-1 rounded-full bg-emerald-500/20 animate-pulse" />
                      <div className="h-9 w-9 sm:h-11 sm:w-11 rounded-full bg-gradient-to-tr from-amber-600 to-orange-600 flex items-center justify-center font-bold text-white text-xs shadow-md">
                        EV
                      </div>
                    </div>
                    <span className="mt-1.5 text-[11px] font-medium text-rm-text">Elena V.</span>
                    <div className="absolute bottom-1.5 left-1.5 rounded-md bg-rm-bg-elevated/90 backdrop-blur-md px-1.5 py-0.5 text-[9px] text-emerald-400 font-medium">
                      Speaking...
                    </div>
                  </div>
                </div>

                {/* Control Dock */}
                <div className="mt-2.5 flex items-center justify-center gap-2 py-1.5 rounded-xl border border-rm-border/60 bg-rm-bg-elevated">
                  <button type="button" className="flex h-8 w-8 items-center justify-center rounded-lg bg-rm-bg-surface text-rm-text border border-rm-border/60 hover:bg-rm-bg-hover transition-all cursor-pointer">
                    <Mic className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" className="flex h-8 w-8 items-center justify-center rounded-lg bg-rm-bg-surface text-rm-text border border-rm-border/60 hover:bg-rm-bg-hover transition-all cursor-pointer">
                    <Video className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" className="flex h-8 w-8 items-center justify-center rounded-lg bg-rm-accent text-white hover:bg-rm-accent-hover transition-all cursor-pointer shadow-md">
                    <Monitor className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" className="flex h-8 px-3 items-center justify-center gap-1 rounded-lg bg-red-600 text-xs font-bold text-white hover:bg-red-700 transition-all cursor-pointer">
                    <PhoneOff className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Leave</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-1 flex-col justify-between bg-rm-bg-primary animate-fade-in-up" style={{ animationDuration: "250ms" }}>
                {/* Chat Sub-header */}
                <div className="flex h-9 items-center justify-between border-b border-rm-border/60 bg-rm-bg-elevated px-3 select-none shrink-0">
                  <div className="flex items-center gap-1.5">
                    <Hash className="h-3.5 w-3.5 text-rm-accent" />
                    <span className="font-extrabold text-xs text-rm-text">general</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-rm-text-muted">
                    <Users className="h-3.5 w-3.5 text-rm-accent" />
                    <span className="text-[10px] font-bold text-rm-text-secondary">42 online</span>
                  </div>
                </div>

                {/* Chat Feed */}
                <div className="flex flex-1 flex-col gap-2.5 p-3 overflow-hidden justify-end text-xs text-left">
                  <div className="flex items-start gap-2">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-tr from-blue-600 to-indigo-600 font-bold text-white text-[10px] shadow-md">
                      AR
                    </div>
                    <div className="flex flex-col min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-rm-text text-[11px]">Alex Rivera</span>
                        <span className="rounded bg-rm-accent/20 px-1 py-0.2 text-[8px] font-bold text-rm-accent uppercase">MOD</span>
                        <span className="text-[9px] text-rm-text-muted">2:14 PM</span>
                      </div>
                      <p className="text-rm-text-secondary text-[11px] leading-snug">
                        Deployed multi-region WebRTC relays across 300+ edge locations! Latency down 40%. 🚀
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-2">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-tr from-emerald-600 to-teal-600 font-bold text-white text-[10px] shadow-md">
                      SC
                    </div>
                    <div className="flex flex-col min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-rm-text text-[11px]">Sarah Chen</span>
                        <span className="text-[9px] text-rm-text-muted">2:15 PM</span>
                      </div>
                      <p className="text-rm-text-secondary text-[11px] leading-snug">
                        Tested Lounge Voice with 8 participants. Audio clarity is top notch!
                      </p>
                    </div>
                  </div>
                </div>

                {/* Message Input Box */}
                <div className="p-2 bg-rm-bg-elevated border-t border-rm-border/50 shrink-0">
                  <div className="flex items-center gap-2 rounded-xl border border-rm-border/70 bg-rm-bg-surface/60 px-2.5 py-1.5">
                    <Plus className="h-3.5 w-3.5 text-rm-text-muted shrink-0" />
                    <input
                      type="text"
                      readOnly
                      aria-label="Chat message preview"
                      placeholder="Message #general"
                      className="flex-1 bg-transparent text-xs text-rm-text placeholder:text-rm-text-muted focus:outline-none min-w-0"
                    />
                    <button type="button" className="flex h-5 w-5 items-center justify-center rounded-lg bg-rm-accent text-white shrink-0">
                      <Send className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function NetworkVisual() {
  return (
    <div className="relative flex h-64 w-full items-center justify-center overflow-hidden rounded-xl border border-rm-border bg-rm-bg-primary backdrop-blur-md sm:h-72 select-none">
      {/* Grid Overlay & Glow */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_10%,var(--rm-bg-primary)_95%)] pointer-events-none z-10" />
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff05_1px,transparent_1px),linear-gradient(to_bottom,#ffffff05_1px,transparent_1px)] bg-[size:2rem_2rem]" />
      
      {/* Top Telemetry Badge */}
      <div className="absolute top-3 right-3 z-20 flex items-center gap-1.5 rounded-full bg-rm-bg-secondary/80 border border-rm-border/60 px-2.5 py-1 text-[10px] font-mono font-bold text-rm-text-secondary shadow-lg backdrop-blur-md">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
        <span>Global Mesh • 10 Gbps</span>
      </div>

      <svg className="absolute inset-0 h-full w-full opacity-75 z-0" viewBox="0 0 400 240" fill="none" xmlns="http://www.w3.org/2000/svg">
        {/* Connection Paths */}
        <path d="M 60,60 Q 130,90 200,120" stroke="var(--rm-accent)" strokeWidth="1.5" strokeOpacity="0.25" strokeDasharray="3 3" />
        <path d="M 340,50 Q 270,80 200,120" stroke="var(--rm-accent)" strokeWidth="1.5" strokeOpacity="0.25" strokeDasharray="3 3" />
        <path d="M 80,180 Q 140,150 200,120" stroke="var(--rm-accent)" strokeWidth="1.5" strokeOpacity="0.25" strokeDasharray="3 3" />
        <path d="M 320,190 Q 260,160 200,120" stroke="var(--rm-accent)" strokeWidth="1.5" strokeOpacity="0.25" strokeDasharray="3 3" />

        {/* Dynamic Pulse Beams */}
        <path d="M 60,60 Q 130,90 200,120" stroke="var(--rm-accent)" strokeWidth="2" strokeLinecap="round" className="animate-pulse" />
        <path d="M 340,50 Q 270,80 200,120" stroke="var(--rm-accent)" strokeWidth="2" strokeLinecap="round" className="animate-pulse" style={{ animationDelay: '0.5s' }} />
        <path d="M 80,180 Q 140,150 200,120" stroke="var(--rm-accent)" strokeWidth="2" strokeLinecap="round" className="animate-pulse" style={{ animationDelay: '1s' }} />
        <path d="M 320,190 Q 260,160 200,120" stroke="var(--rm-accent)" strokeWidth="2" strokeLinecap="round" className="animate-pulse" style={{ animationDelay: '1.5s' }} />
      </svg>

      {/* Central Cloudflare SFU Core */}
      <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1.5 z-20">
        <div className="relative flex h-12 w-12 items-center justify-center rounded-full bg-rm-accent/20 border border-rm-accent/60 text-rm-accent shadow-[0_0_30px_rgba(88,101,242,0.4)]">
          <span className="absolute -inset-1 rounded-full border border-rm-accent/40 animate-ping opacity-40" />
          <Globe2 className="h-6 w-6 text-white" />
        </div>
        <span className="font-mono text-[9px] font-extrabold uppercase tracking-widest text-rm-text bg-rm-bg-elevated/90 px-2.5 py-0.5 rounded-full border border-rm-accent/40 shadow-xl backdrop-blur-md">
          SFU Core
        </span>
      </div>

      {/* Node 1: SFO */}
      <div className="absolute left-[15%] top-[25%] flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1 z-20">
        <div className="relative">
          <div className="h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_12px_#34d399] animate-ping" />
          <div className="absolute inset-0 h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_12px_#34d399]" />
        </div>
        <span className="font-mono text-[9px] font-bold text-rm-text-secondary bg-rm-bg-surface/80 px-2 py-0.5 rounded-md border border-rm-border/60 shadow-md backdrop-blur-sm">
          SFO: 12ms
        </span>
      </div>

      {/* Node 2: TYO */}
      <div className="absolute left-[85%] top-[20%] flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1 z-20">
        <div className="relative">
          <div className="h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_12px_#34d399] animate-ping" style={{ animationDelay: '0.4s' }} />
          <div className="absolute inset-0 h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_12px_#34d399]" />
        </div>
        <span className="font-mono text-[9px] font-bold text-rm-text-secondary bg-rm-bg-surface/80 px-2 py-0.5 rounded-md border border-rm-border/60 shadow-md backdrop-blur-sm">
          TYO: 84ms
        </span>
      </div>

      {/* Node 3: LHR */}
      <div className="absolute left-[20%] top-[75%] flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1 z-20">
        <div className="relative">
          <div className="h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_12px_#34d399] animate-ping" style={{ animationDelay: '0.8s' }} />
          <div className="absolute inset-0 h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_12px_#34d399]" />
        </div>
        <span className="font-mono text-[9px] font-bold text-rm-text-secondary bg-rm-bg-surface/80 px-2 py-0.5 rounded-md border border-rm-border/60 shadow-md backdrop-blur-sm">
          LHR: 42ms
        </span>
      </div>

      {/* Node 4: SYD */}
      <div className="absolute left-[80%] top-[80%] flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1 z-20">
        <div className="relative">
          <div className="h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_12px_#34d399] animate-ping" style={{ animationDelay: '1.2s' }} />
          <div className="absolute inset-0 h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_12px_#34d399]" />
        </div>
        <span className="font-mono text-[9px] font-bold text-rm-text-secondary bg-rm-bg-surface/80 px-2 py-0.5 rounded-md border border-rm-border/60 shadow-md backdrop-blur-sm">
          SYD: 108ms
        </span>
      </div>
    </div>
  );
}

function AnimatedChatShowcase() {
  const [activeChannel, setActiveChannel] = useState("general");

  return (
    <div className="relative w-full overflow-hidden rounded-t-xl border-t border-x border-rm-border bg-rm-bg-primary text-rm-text shadow-2xl transition-transform duration-700 ease-out group-hover:scale-[1.01]">
      {/* Authentic App Window Bar */}
      <div className="flex h-9 items-center justify-between border-b border-rm-border/60 bg-rm-bg-elevated px-3 select-none">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <div className="h-3 w-3 rounded-full bg-[#ff5f56] hover:opacity-80 transition-opacity cursor-pointer" />
            <div className="h-3 w-3 rounded-full bg-[#ffbd2e] hover:opacity-80 transition-opacity cursor-pointer" />
            <div className="h-3 w-3 rounded-full bg-[#27c93f] hover:opacity-80 transition-opacity cursor-pointer" />
          </div>
        </div>
        <div className="flex items-center gap-2 text-[11px] font-semibold text-rm-text-muted truncate px-2">
          <ShieldCheck className="h-3.5 w-3.5 text-rm-accent shrink-0" />
          <span className="truncate">Ralph Meet — Desktop Client v1.8.0</span>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] font-medium text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full ring-1 ring-emerald-500/20 shrink-0">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="hidden sm:inline">Connected</span>
        </div>
      </div>

      {/* Interface Layout - Responsive Sidebar Collapses on Small Mobile */}
      <div className="flex h-[340px] sm:h-[350px] w-full text-xs text-left">
        {/* Left Sidebar - Hidden on mobile screens for crisp responsiveness */}
        <div className="hidden md:flex w-52 shrink-0 border-r border-rm-border/60 bg-rm-bg-sidebar flex-col justify-between select-none">
          <div className="flex flex-col">
            {/* Server Header */}
            <div className="flex h-12 items-center justify-between border-b border-rm-border/50 px-3 hover:bg-rm-bg-hover transition-colors cursor-pointer">
              <div className="flex items-center gap-2 min-w-0">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-gradient-to-tr from-rm-accent to-purple-500 font-bold text-white text-[11px]">
                  R
                </div>
                <span className="font-bold text-[13px] text-rm-text truncate">Ralph Community</span>
              </div>
              <ChevronDown className="h-4 w-4 text-rm-text-muted shrink-0" />
            </div>

            {/* Channel Sections */}
            <div className="p-2 flex flex-col gap-3 overflow-hidden">
              {/* Text Channels Category */}
              <div className="flex flex-col gap-0.5">
                <div className="flex items-center justify-between px-2 py-1 text-rm-text-muted">
                  <div className="flex items-center gap-1 text-[10px] font-extrabold uppercase tracking-wider">
                    <ChevronDown className="h-3 w-3" />
                    <span>Text Channels</span>
                  </div>
                  <Plus className="h-3.5 w-3.5 hover:text-rm-text cursor-pointer transition-colors" />
                </div>

                {[
                  { id: "general", name: "general", icon: Hash, unread: 0 },
                  { id: "dev-talk", name: "dev-talk", icon: Hash, unread: 4 },
                  { id: "announcements", name: "announcements", icon: Pin, unread: 0 },
                ].map((ch) => {
                  const Icon = ch.icon;
                  const isActive = activeChannel === ch.id;
                  return (
                    <button
                      key={ch.id}
                      type="button"
                      onClick={() => setActiveChannel(ch.id)}
                      className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 transition-all cursor-pointer ${
                        isActive
                          ? "bg-rm-accent/20 font-semibold text-rm-accent ring-1 ring-rm-accent/40"
                          : "text-rm-text-secondary hover:bg-rm-bg-hover hover:text-rm-text"
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate">
                        <Icon className={`h-4 w-4 shrink-0 ${isActive ? "text-rm-accent" : "text-rm-text-muted"}`} />
                        <span className="truncate text-[12px]">{ch.name}</span>
                      </div>
                      {ch.unread > 0 && (
                        <span className="rounded-full bg-rm-accent px-1.5 py-0.2 text-[9px] font-bold text-white shadow-sm">
                          {ch.unread}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Voice Channels Category */}
              <div className="flex flex-col gap-0.5 pt-1">
                <div className="flex items-center justify-between px-2 py-1 text-rm-text-muted">
                  <div className="flex items-center gap-1 text-[10px] font-extrabold uppercase tracking-wider">
                    <ChevronDown className="h-3 w-3" />
                    <span>Voice Channels</span>
                  </div>
                  <Plus className="h-3.5 w-3.5 hover:text-rm-text cursor-pointer transition-colors" />
                </div>

                <button
                  type="button"
                  onClick={() => setActiveChannel("lounge-voice")}
                  className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 transition-all cursor-pointer ${
                    activeChannel === "lounge-voice"
                      ? "bg-rm-accent/20 font-semibold text-rm-accent ring-1 ring-rm-accent/40"
                      : "text-rm-text-secondary hover:bg-rm-bg-hover hover:text-rm-text"
                  }`}
                >
                  <div className="flex items-center gap-2 truncate">
                    <Volume2 className="h-4 w-4 text-emerald-400 shrink-0" />
                    <span className="truncate text-[12px]">Lounge Voice</span>
                  </div>
                  <span className="flex h-2 w-2 relative">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </span>
                </button>

                {/* Connected Voice Members Sublist */}
                <div className="ml-6 flex flex-col gap-1 pt-0.5">
                  <div className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-rm-bg-hover transition-colors">
                    <div className="relative">
                      <div className="h-5 w-5 rounded-full bg-indigo-600 flex items-center justify-center text-[9px] font-bold text-white ring-1 ring-emerald-500">
                        AR
                      </div>
                      <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-emerald-500 ring-1 ring-rm-bg-sidebar" />
                    </div>
                    <span className="text-[11px] text-rm-text font-medium truncate">Alex Rivera</span>
                  </div>
                  <div className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-rm-bg-hover transition-colors">
                    <div className="relative">
                      <div className="h-5 w-5 rounded-full bg-teal-600 flex items-center justify-center text-[9px] font-bold text-white">
                        SC
                      </div>
                      <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-emerald-500 ring-1 ring-rm-bg-sidebar" />
                    </div>
                    <span className="text-[11px] text-rm-text-secondary truncate">Sarah Chen</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* User Control Panel at Bottom Left */}
          <div className="flex h-14 items-center justify-between border-t border-rm-border/60 bg-rm-bg-elevated px-2.5">
            <div className="flex items-center gap-2 min-w-0">
              <div className="relative shrink-0">
                <div className="h-8 w-8 rounded-full bg-gradient-to-tr from-rm-accent to-indigo-500 flex items-center justify-center font-bold text-white text-xs shadow-md">
                  J
                </div>
                <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-rm-bg-elevated" />
              </div>
              <div className="flex flex-col min-w-0">
                <span className="font-bold text-[12px] text-rm-text truncate leading-tight">Jonathan</span>
                <span className="text-[10px] text-emerald-400 font-medium leading-tight">Online</span>
              </div>
            </div>
            <div className="flex items-center gap-1 text-rm-text-muted">
              <button type="button" title="Mute Microphone" className="p-1 hover:bg-rm-bg-hover rounded hover:text-rm-text transition-colors">
                <Mic className="h-3.5 w-3.5" />
              </button>
              <button type="button" title="Deafen Audio" className="p-1 hover:bg-rm-bg-hover rounded hover:text-rm-text transition-colors">
                <Headphones className="h-3.5 w-3.5" />
              </button>
              <button type="button" title="User Settings" className="p-1 hover:bg-rm-bg-hover rounded hover:text-rm-text transition-colors">
                <Settings className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Chat Main Area */}
        <div className="flex flex-1 flex-col justify-between bg-rm-bg-primary min-w-0">
          {/* Chat Header Bar */}
          <div className="flex h-12 shrink-0 items-center justify-between border-b border-rm-border/60 bg-rm-bg-elevated px-3 sm:px-4 select-none">
            <div className="flex items-center gap-2 min-w-0">
              <Hash className="h-5 w-5 text-rm-text-muted shrink-0" />
              <span className="font-extrabold text-[14px] text-rm-text truncate">{activeChannel}</span>
              <span className="hidden lg:inline-block text-[11px] text-rm-text-muted pl-2 border-l border-rm-border/50 truncate">
                Official server discussion & edge updates
              </span>
            </div>
            <div className="flex items-center gap-2.5 text-rm-text-muted shrink-0">
              <button type="button" className="hover:text-rm-text transition-colors" title="Pinned Messages">
                <Pin className="h-4 w-4" />
              </button>
              <button type="button" className="hover:text-rm-text transition-colors" title="Notifications">
                <Bell className="h-4 w-4" />
              </button>
              <button type="button" className="hover:text-rm-text transition-colors" title="Member List">
                <Users className="h-4 w-4 text-rm-accent" />
              </button>
            </div>
          </div>

          {/* Messages Feed */}
          <div className="flex flex-1 flex-col gap-3.5 p-3 sm:p-4 overflow-hidden justify-end">
            <div className="flex items-start gap-2.5 sm:gap-3 group">
              <div className="flex h-7 w-7 sm:h-8 sm:w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-tr from-blue-600 to-indigo-600 font-bold text-white text-[11px] sm:text-xs shadow-md ring-1 ring-rm-border/40">
                AR
              </div>
              <div className="flex flex-col gap-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-rm-text text-[12px] sm:text-[13px] hover:underline cursor-pointer">Alex Rivera</span>
                  <span className="rounded bg-rm-accent/20 px-1.5 py-0.2 text-[8px] sm:text-[9px] font-bold text-rm-accent uppercase tracking-wider">MOD</span>
                  <span className="text-[10px] text-rm-text-muted">Today at 2:14 PM</span>
                </div>
                <p className="text-rm-text-secondary text-[11px] sm:text-[12px] leading-relaxed">
                  Just deployed the new multi-region WebRTC relay via Cloudflare Workers! Anyone free to test voice channels? 🚀
                </p>
              </div>
            </div>

            <div className="flex items-start gap-2.5 sm:gap-3 group">
              <div className="flex h-7 w-7 sm:h-8 sm:w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-tr from-emerald-600 to-teal-600 font-bold text-white text-[11px] sm:text-xs shadow-md ring-1 ring-rm-border/40">
                SC
              </div>
              <div className="flex flex-col gap-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-rm-text text-[12px] sm:text-[13px] hover:underline cursor-pointer">Sarah Chen</span>
                  <span className="text-[10px] text-rm-text-muted">Today at 2:15 PM</span>
                </div>
                <p className="text-rm-text-secondary text-[11px] sm:text-[12px] leading-relaxed">
                  Connected to <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-emerald-400 font-semibold text-[10px] sm:text-[11px] inline-flex items-center gap-1"><Volume2 className="h-3 w-3" /> Lounge Voice</span> right now! Latency is practically zero.
                </p>
              </div>
            </div>
          </div>

          {/* Authentic Message Input Container */}
          <div className="p-2.5 sm:p-3 bg-rm-bg-elevated border-t border-rm-border/50">
            <div className="flex items-center gap-2 text-[10px] text-rm-text-muted mb-1 px-1">
              <span className="flex gap-1 items-center">
                <span className="h-1.5 w-1.5 rounded-full bg-rm-accent animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="h-1.5 w-1.5 rounded-full bg-rm-accent animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="h-1.5 w-1.5 rounded-full bg-rm-accent animate-bounce" style={{ animationDelay: "300ms" }} />
              </span>
              <span className="font-medium text-rm-text-secondary">Devin is typing...</span>
            </div>
            <div className="flex items-center gap-2 rounded-xl border border-rm-border/70 bg-rm-bg-surface/60 px-2.5 py-2 sm:px-3 sm:py-2.5 shadow-inner focus-within:border-rm-accent/60 transition-colors">
              <button type="button" className="flex h-6 w-6 items-center justify-center rounded-full bg-rm-bg-surface border border-rm-border/60 hover:bg-rm-bg-hover text-rm-text-muted hover:text-rm-text transition-colors shrink-0">
                <Plus className="h-4 w-4" />
              </button>
              <input
                type="text"
                readOnly
                aria-label={`Message ${activeChannel}`}
                placeholder={`Message #${activeChannel}`}
                className="flex-1 bg-transparent text-[11px] sm:text-[12px] text-rm-text placeholder:text-rm-text-muted focus:outline-none min-w-0"
              />
              <div className="flex items-center gap-1.5 sm:gap-2 text-rm-text-muted shrink-0">
                <button type="button" className="hover:text-rm-text transition-colors hidden sm:inline-block"><Smile className="h-4 w-4" /></button>
                <button type="button" className="hover:text-rm-text transition-colors hidden sm:inline-block"><Paperclip className="h-4 w-4" /></button>
                <button type="button" className="flex h-6 w-6 sm:h-7 sm:w-7 items-center justify-center rounded-lg bg-rm-accent text-white hover:bg-rm-accent-hover transition-colors shadow-sm">
                  <Send className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AnimatedVoiceShowcase() {
  const [joined, setJoined] = useState(false);

  return (
    <div className="relative w-full h-[340px] sm:h-[350px] overflow-hidden rounded-t-xl border-t border-x border-rm-border bg-rm-bg-primary text-rm-text p-4 sm:p-6 flex flex-col justify-between select-none transition-transform duration-700 ease-out group-hover:scale-[1.01]">
      <div className="flex items-center justify-between border-b border-rm-border/50 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/30 shadow-md">
            <Volume2 className="h-5 w-5 animate-pulse" />
          </div>
          <div className="flex flex-col text-left">
            <span className="text-sm font-extrabold text-rm-text">Lounge Voice</span>
            <span className="text-[11px] text-emerald-400 font-medium">3 friends connected</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-bold text-emerald-400 ring-1 ring-emerald-500/30">
          <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
          <span>Live Room</span>
        </div>
      </div>

      <div className="flex flex-col items-center justify-center gap-4 py-4">
        <div className="flex items-center -space-x-3">
          <div className="relative">
            <div className="h-12 w-12 rounded-full bg-gradient-to-tr from-indigo-600 to-blue-500 flex items-center justify-center font-bold text-white text-sm shadow-xl ring-2 ring-rm-bg-primary">
              AR
            </div>
            <span className="absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full bg-emerald-400 ring-2 ring-rm-bg-primary" />
          </div>
          <div className="relative">
            <div className="h-12 w-12 rounded-full bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center font-bold text-white text-sm shadow-xl ring-2 ring-rm-bg-primary">
              SC
            </div>
            <span className="absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full bg-emerald-400 ring-2 ring-rm-bg-primary" />
          </div>
          <div className="relative">
            <div className="h-12 w-12 rounded-full bg-gradient-to-tr from-purple-600 to-pink-500 flex items-center justify-center font-bold text-white text-sm shadow-xl ring-2 ring-rm-bg-primary">
              MR
            </div>
            <span className="absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full bg-emerald-400 ring-2 ring-rm-bg-primary" />
          </div>
        </div>

        <div className="flex items-center gap-1.5 h-6">
          {[40, 70, 30, 90, 50, 80, 40].map((h, i) => (
            <span
              key={i}
              className="w-1.5 rounded-full bg-emerald-400/80 animate-pulse"
              style={{ height: `${h}%`, animationDelay: `${i * 0.15}s` }}
            />
          ))}
        </div>
      </div>

      <div className="pt-3 border-t border-rm-border/40">
        {!joined ? (
          <button
            type="button"
            onClick={() => setJoined(true)}
            className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white font-bold text-xs sm:text-sm shadow-lg shadow-emerald-500/20 transition-all duration-300 active:scale-[0.98] flex items-center justify-center gap-2 cursor-pointer"
          >
            <Volume2 className="h-4 w-4" />
            <span>Drop in to Lounge Voice</span>
          </button>
        ) : (
          <div className="w-full py-2.5 px-4 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-between text-xs font-bold text-emerald-400 animate-fade-in-up">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>Connected (14ms)</span>
            </div>
            <button
              type="button"
              onClick={() => setJoined(false)}
              className="px-2.5 py-1 rounded-lg bg-red-600/80 hover:bg-red-600 text-white text-[11px] transition-colors cursor-pointer"
            >
              Leave
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function HomePageFeatureBlocks() {
  return (
    <section className="w-full border-t border-rm-border bg-rm-bg-secondary/20 py-20 px-6 sm:px-12 md:py-28">
      <div className="mx-auto w-full max-w-7xl">
        <h2 className="mb-16 text-center text-3xl font-extrabold tracking-tight text-rm-text sm:text-4xl md:text-5xl">
          Everything you need to stay close
        </h2>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 w-full">
          {/* Cell 1: Topic channels (Large - span 2 cols on lg) */}
          <div className="group relative overflow-hidden rounded-2xl border border-rm-border bg-rm-bg-surface/30 pt-8 px-8 pb-0 shadow-2xl backdrop-blur-sm lg:col-span-2 flex flex-col justify-between transition-all duration-300 hover:border-rm-accent/20 hover:shadow-rm-accent/5">
            <div className="mb-6 max-w-xl text-left">
              <h3 className="mb-2 text-2xl font-bold tracking-tight text-rm-text sm:text-3xl">
                Topic-based channels
              </h3>
              <p className="text-sm leading-relaxed text-rm-text-secondary sm:text-base">
                Rooms are organized into focused text and voice channels. Collaborate on projects, share code, or simply hang out without cluttering up a single long message thread.
              </p>
            </div>
            <div className="relative mt-auto overflow-hidden rounded-t-xl border-t border-x border-rm-border bg-rm-bg-primary/50 shadow-inner">
              <AnimatedChatShowcase />
            </div>
          </div>

          {/* Cell 2: Easy Hangout (Medium - span 1 col on lg) */}
          <div className="group relative overflow-hidden rounded-2xl border border-rm-border bg-rm-bg-surface/30 pt-8 px-8 pb-0 shadow-2xl backdrop-blur-sm flex flex-col justify-between transition-all duration-300 hover:border-rm-accent/20 hover:shadow-rm-accent/5">
            <div className="mb-6 text-left">
              <h3 className="mb-2 text-2xl font-bold tracking-tight text-rm-text sm:text-3xl">
                Hanging out is easy
              </h3>
              <p className="text-sm leading-relaxed text-rm-text-secondary sm:text-base">
                Grab a seat in a voice room when you are free. Friends in your space can see you are around and instantly drop in to talk.
              </p>
            </div>
            <div className="relative mt-auto overflow-hidden rounded-t-xl border-t border-x border-rm-border bg-rm-bg-primary/50 shadow-inner">
              <AnimatedVoiceShowcase />
            </div>
          </div>

          {/* Cell 3: Cloudflare SFU (Full width - span 3 cols on lg) */}
          <div className="group relative overflow-hidden rounded-2xl border border-rm-border bg-rm-bg-surface/30 p-8 shadow-2xl backdrop-blur-sm lg:col-span-3 grid grid-cols-1 md:grid-cols-2 gap-8 items-center transition-all duration-300 hover:border-rm-accent/20 text-left">
            <div className="space-y-4">
              <h3 className="text-2xl font-bold tracking-tight text-rm-text sm:text-3xl">
                Built on the global edge
              </h3>
              <p className="text-sm leading-relaxed text-rm-text-secondary sm:text-base">
                Your video, audio, and screenshares route through the fastest path on the planet via Cloudflare's ultra-low latency SFU network. Enjoy real-time speed that makes you feel in the same room.
              </p>
            </div>
            <NetworkVisual />
          </div>
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
  return (
    <section className="relative flex w-full flex-col items-center justify-center px-6 py-24 text-center sm:py-32">
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden">
        <div className="h-[350px] w-[350px] animate-pulse rounded-full bg-rm-accent/5 blur-[100px]" />
      </div>

      <h2 className="relative z-10 mb-8 text-3xl font-extrabold tracking-tight text-rm-text sm:text-4xl md:text-5xl">
        Ready to start your journey?
      </h2>

      <form
        onSubmit={joinRoom}
        className="group relative z-10 flex w-full max-w-[512px] flex-col gap-2 rounded-2xl bg-rm-bg-surface p-2 shadow-2xl ring-1 ring-rm-border backdrop-blur-xl transition-all duration-300 focus-within:ring-rm-accent sm:flex-row"
      >
        <div className="relative flex-1">
          <input
            type="text"
            id="join-room-input"
            aria-label="Room code or link"
            value={room}
            onChange={(e) => setRoom(e.target.value)}
            placeholder="Enter room code or link..."
            spellCheck={false}
            autoComplete="off"
            className="h-full w-full rounded-xl bg-transparent px-4 py-3 text-base font-medium text-rm-text outline-none placeholder:text-rm-text-muted"
          />
        </div>
        <button
          type="submit"
          id="join-room-submit"
          disabled={!room.trim()}
          className="group/btn flex w-full shrink-0 items-center justify-center gap-2 rounded-xl bg-rm-accent px-6 py-3 font-bold text-white shadow-lg transition-all duration-300 hover:bg-rm-accent-hover disabled:bg-rm-bg-elevated disabled:text-rm-text-muted disabled:border disabled:border-rm-border disabled:shadow-none disabled:opacity-60 active:scale-[0.98] sm:w-auto cursor-pointer"
        >
          <span className="text-base">Join Room</span>
          <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover/btn:translate-x-1" />
        </button>
      </form>

      <p className="relative z-10 mt-6 text-xs font-medium text-rm-text-muted">
        Free forever. No credit card required.
      </p>
    </section>
  );
}

function HomePageFooter() {
  return (
    <footer className="relative z-10 w-full border-t border-rm-border bg-rm-bg-primary/60 px-6 py-12 backdrop-blur-md md:py-16 sm:px-10">
      <div className="mx-auto w-full max-w-7xl">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 md:gap-12 pb-12">
          {/* Brand Info */}
          <div className="col-span-2 md:col-span-1 flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-rm-bg-surface text-rm-text ring-1 ring-rm-border shadow-xs">
                <HomeIcon className="h-4 w-4" />
              </div>
              <span className="text-sm font-bold tracking-tight text-rm-text">Ralph Meet</span>
            </div>
            <p className="text-xs leading-relaxed text-rm-text-muted max-w-[200px]">
              A high-performance real-time video conferencing & chat application built on the global edge.
            </p>
          </div>

          {/* Product Links */}
          <div className="flex flex-col gap-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-rm-text">Product</h4>
            <ul className="flex flex-col gap-2 text-xs font-medium text-rm-text-muted">
              <li>
                <a href="#hero-try-free" className="transition-colors hover:text-rm-text-secondary">
                  Try It Free
                </a>
              </li>
              <li>
                <a
                  href="https://github.com/115jon/ralph-meet/releases/download/v1.9.0/RalphMeetSetup.exe"
                  className="transition-colors hover:text-rm-text-secondary"
                >
                  Download App (Win)
                </a>
              </li>
              <li>
                <a href="/sign-in" className="transition-colors hover:text-rm-text-secondary">
                  Open Chat
                </a>
              </li>
              <li>
                <a href="/sign-in" className="transition-colors hover:text-rm-text-secondary">
                  Sign In
                </a>
              </li>
              <li>
                <a href="/sign-up" className="transition-colors hover:text-rm-text-secondary">
                  Sign Up
                </a>
              </li>
            </ul>
          </div>

          {/* Developer Links */}
          <div className="flex flex-col gap-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-rm-text">Developers</h4>
            <ul className="flex flex-col gap-2 text-xs font-medium text-rm-text-muted">
              <li>
                <a
                  href="https://github.com/115jon/ralph-meet"
                  target="_blank"
                  rel="noreferrer"
                  className="transition-colors hover:text-rm-text-secondary"
                >
                  GitHub Repository
                </a>
              </li>
              <li>
                <a
                  href="https://github.com/115jon/ralph-meet/releases/latest"
                  target="_blank"
                  rel="noreferrer"
                  className="transition-colors hover:text-rm-text-secondary"
                >
                  Latest Releases
                </a>
              </li>
            </ul>
          </div>

          {/* Status & Privacy Links */}
          <div className="flex flex-col gap-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-rm-text">Company</h4>
            <ul className="flex flex-col gap-2 text-xs font-medium text-rm-text-muted">
              <li>
                <a
                  href="https://www.cloudflare.com/privacypolicy/"
                  target="_blank"
                  rel="noreferrer"
                  className="transition-colors hover:text-rm-text-secondary"
                >
                  Privacy Policy
                </a>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="flex flex-col items-center justify-between gap-4 border-t border-rm-border/40 pt-8 sm:flex-row">
          <p className="text-center text-xs font-medium text-rm-text-muted">
            &copy; {new Date().getFullYear()} Ralph Meet. All rights reserved.
          </p>
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
    navigate({ to: `/room/${slug}` });
  };

  const joinRoom = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = room.trim().toLowerCase().replace(/\s+/g, "-");
    if (trimmed) {
      navigate({ to: `/room/${trimmed}` });
    }
  };

  return (
    <div className="relative flex min-h-full flex-col overflow-y-auto bg-rm-bg-primary selection:bg-rm-accent/30">
      {/* Premium Orb Background - Fixed so it doesn't scroll */}
      <div className="pointer-events-none fixed inset-0 flex items-center justify-center overflow-hidden">
        <div
          className="absolute left-[-10%] top-[-10%] h-[600px] w-[600px] animate-pulse rounded-full bg-rm-accent/10 mix-blend-screen blur-[120px]"
          style={{ animationDuration: "8s" }}
        />
        <div
          className="absolute bottom-[-10%] right-[-10%] h-[600px] w-[600px] animate-pulse rounded-full bg-primary/5 mix-blend-screen blur-[120px]"
          style={{ animationDuration: "10s" }}
        />
        <div className="absolute left-[20%] top-[40%] h-[400px] w-[400px] rounded-full bg-rm-accent/5 mix-blend-screen blur-[100px]" />
      </div>

      {/* Grid Pattern Overlay */}
      <div className="pointer-events-none fixed inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCI+PHBhdGggZD0iTTAgMGgyNHYyNEgweiIgZmlsbD0ibm9uZSIvPjxwYXRoIGQ9Ik0wIG0gMGgyNHYxSDB6bTAgMjNoMjR2MUgweiIgZmlsbD0icmdiYSgyNTUsIDI1NSwgMjU1LCAwLjAxKSIvPjxwYXRoIGQ9Ik0wIG0gdjI0SDF2LTI0em0yMyAwdjI0aDF2LTI0eiIgZmlsbD0icmdiYSgyNTUsIDI1NSwgMjU1LCAwLjAxKSIvPjwvc3ZnPg==')] opacity-50" />

      <HomePageHeader />

      <main className="relative z-10 flex w-full flex-col items-center">
        <HomePageHero createRoom={createRoom} />
        <HomePageFeatureBlocks />
        <HomePageCTA joinRoom={joinRoom} room={room} setRoom={setRoom} />
      </main>

      <HomePageFooter />

      {profileOpen && <SettingsModal onClose={() => setProfileOpen(false)} />}

      <style>{`
        @keyframes float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-6px); }
        }
        @keyframes fadeInUp {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @keyframes floatSlow {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          50% { transform: translateY(-8px) rotate(0.5deg); }
        }
        @keyframes floatSlower {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          50% { transform: translateY(8px) rotate(-0.5deg); }
        }
        @keyframes pulseDash {
          to {
            stroke-dashoffset: -20;
          }
        }
        .animate-fade-in-up {
          animation: fadeInUp 0.8s cubic-bezier(0.16, 1, 0.3, 1) both;
        }
        .animate-float-slow {
          animation: floatSlow 8s ease-in-out infinite;
        }
        .animate-float-slower {
          animation: floatSlower 10s ease-in-out infinite;
        }
        .animate-pulse-dash {
          stroke-dasharray: 5 15;
          animation: pulseDash 1.5s linear infinite;
        }
      `}</style>
    </div>
  );
}
