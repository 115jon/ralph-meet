"use client";

import SettingsModal from "@/components/chat/SettingsModal";
import {
  SignInButton,
  SignedIn,
  SignedOut,
  UserButton,
} from "@clerk/nextjs";
import {
  ArrowRight,
  KeyRound,
  MessageSquare,
  Radio,
  Sparkles,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function HomePageClient() {
  const router = useRouter();
  const [room, setRoom] = useState("");
  const [profileOpen, setProfileOpen] = useState(false);

  const createRoom = () => {
    const slug =
      Math.random().toString(36).substring(2, 8) +
      "-" +
      Math.random().toString(36).substring(2, 6);
    router.push(`/room/${slug}`);
  };

  const joinRoom = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = room.trim().toLowerCase().replace(/\s+/g, "-");
    if (trimmed) {
      router.push(`/room/${trimmed}`);
    }
  };

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[var(--rm-bg-primary)] px-6">
      {/* Animated glow background */}
      <div className="pointer-events-none absolute -top-48 left-1/2 h-[600px] w-[600px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(99,102,241,0.15)_0%,rgba(147,51,234,0.06)_40%,transparent_70%)] blur-xl" />
      <div className="pointer-events-none absolute bottom-0 left-1/2 h-[300px] w-[800px] -translate-x-1/2 bg-[radial-gradient(ellipse,rgba(99,102,241,0.08)_0%,transparent_70%)]" />

      {/* Auth header */}
      <header className="fixed right-0 top-0 z-10 p-4">
        <SignedOut>
          <SignInButton mode="modal">
            <button className="rounded-xl border border-rm-border bg-rm-bg-elevated px-4 py-2 text-sm font-medium text-indigo-400 backdrop-blur-sm transition-all duration-200 hover:border-indigo-500/30 hover:bg-indigo-500/10 hover:text-indigo-300">
              Sign In
            </button>
          </SignInButton>
        </SignedOut>
        <SignedIn>
          <UserButton
            appearance={{
              elements: { avatarBox: { width: 36, height: 36 } },
            }}
          >
            <UserButton.MenuItems>
              <UserButton.Action
                label="Edit Profile"
                labelIcon={<span>✏️</span>}
                onClick={() => setProfileOpen(true)}
              />
            </UserButton.MenuItems>
          </UserButton>
        </SignedIn>
      </header>

      <main className="z-10 flex w-full max-w-[420px] flex-col items-center gap-5">
        {/* Logo */}
        <div className="mb-1 flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 shadow-[0_0_40px_rgba(99,102,241,0.15)] ring-1 ring-rm-border animate-[float_3s_ease-in-out_infinite]">
          <Radio className="h-10 w-10 text-indigo-400" />
        </div>

        <h1 className="bg-gradient-to-r from-rm-text-primary to-indigo-400 bg-clip-text text-center text-4xl font-extrabold tracking-tight text-transparent">
          Ralph Meet
        </h1>
        <p className="text-center text-sm leading-relaxed text-rm-text-muted">
          Real-time video, audio &amp; screen sharing — powered by Cloudflare
        </p>

        <SignedOut>
          <div className="mt-4 flex w-full flex-col gap-4">
            <p className="text-center text-sm text-rm-text-muted">
              Sign in to create or join meetings
            </p>
            <SignInButton mode="modal">
              <button className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-indigo-600 to-purple-600 py-4 text-base font-bold text-primary-foreground shadow-lg shadow-indigo-500/20 transition-all duration-300 hover:-translate-y-0.5 hover:from-indigo-500 hover:to-purple-500 hover:shadow-xl hover:shadow-indigo-500/30">
                <KeyRound className="h-4 w-4" />
                Sign In to Get Started
              </button>
            </SignInButton>
          </div>
        </SignedOut>

        <SignedIn>
          <div className="mt-2 flex w-full flex-col gap-3">
            <button
              onClick={() => router.push("/chat")}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-indigo-600 to-purple-600 py-4 text-base font-bold text-primary-foreground shadow-lg shadow-indigo-500/20 transition-all duration-300 hover:-translate-y-0.5 hover:from-indigo-500 hover:to-purple-500 hover:shadow-xl hover:shadow-indigo-500/30"
            >
              <MessageSquare className="h-5 w-5" />
              Open Chat
            </button>

            <button
              onClick={createRoom}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-purple-600 to-pink-600 py-4 text-base font-bold text-primary-foreground shadow-lg shadow-purple-500/20 transition-all duration-300 hover:-translate-y-0.5 hover:from-purple-500 hover:to-pink-500 hover:shadow-xl hover:shadow-purple-500/30"
            >
              <Sparkles className="h-5 w-5" />
              New Meeting
            </button>

            {/* Divider */}
            <div className="flex items-center gap-3">
              <div className="h-px flex-1 bg-rm-border" />
              <span className="whitespace-nowrap text-[0.65rem] font-semibold uppercase tracking-widest text-rm-text-muted">
                or join existing
              </span>
              <div className="h-px flex-1 bg-rm-border" />
            </div>

            {/* Join form */}
            <form onSubmit={joinRoom} className="flex gap-2.5">
              <input
                type="text"
                value={room}
                onChange={(e) => setRoom(e.target.value)}
                placeholder="Enter room code"
                className="flex-1 rounded-xl border border-rm-border bg-rm-bg-elevated px-4 py-3 text-rm-text-primary outline-none transition-all placeholder:text-rm-text-muted focus:border-indigo-500/30 focus:ring-2 focus:ring-indigo-500/20"
              />
              <button
                type="submit"
                disabled={!room.trim()}
                className="flex items-center gap-1.5 rounded-xl border border-rm-border bg-rm-bg-elevated px-4 py-3 text-sm font-medium text-indigo-400 transition-all duration-200 hover:border-indigo-500/30 hover:bg-indigo-500/10 disabled:opacity-30"
              >
                Join
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </form>
          </div>
        </SignedIn>
      </main>

      <footer className="fixed bottom-0 left-0 right-0 p-4 text-center text-[0.65rem] font-medium text-rm-text-muted">
        Built with Cloudflare Realtime SFU
      </footer>

      {profileOpen && (
        <SettingsModal onClose={() => setProfileOpen(false)} />
      )}

      {/* Float animation keyframes */}
      <style>{`
        @keyframes float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-8px); }
        }
      `}</style>
    </div>
  );
}
