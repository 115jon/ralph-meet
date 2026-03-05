import SettingsModal from "@/components/chat/SettingsModal";
import { HomeDarkSvg } from "@/components/chat/home-svgs";
import { useClerkAppearance } from "@/hooks/useClerkAppearance";
import {
  SignInButton,
  SignedIn,
  SignedOut,
  UserButton,
} from "@clerk/tanstack-react-start";
import { useNavigate } from "@tanstack/react-router";
import {
  Activity,
  ArrowRight,
  Globe2,
  Headphones,
  MessageSquare,
  Sparkles,
  Users2,
  Video
} from "lucide-react";
import { useState } from "react";

export default function HomePageClient() {
  const navigate = useNavigate();
  const [room, setRoom] = useState("");
  const [profileOpen, setProfileOpen] = useState(false);
  const clerkAppearance = useClerkAppearance(true);

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
    <div className="relative flex min-h-screen flex-col overflow-y-auto bg-[#0a0a0a] selection:bg-indigo-500/30">
      {/* Premium Orb Background - Fixed so it doesn't scroll */}
      <div className="pointer-events-none fixed inset-0 flex items-center justify-center overflow-hidden">
        <div
          className="absolute left-[-10%] top-[-10%] h-[600px] w-[600px] animate-pulse rounded-full bg-indigo-500/10 mix-blend-screen blur-[120px]"
          style={{ animationDuration: "8s" }}
        />
        <div
          className="absolute bottom-[-10%] right-[-10%] h-[600px] w-[600px] animate-pulse rounded-full bg-purple-500/10 mix-blend-screen blur-[120px]"
          style={{ animationDuration: "10s" }}
        />
        <div className="absolute left-[20%] top-[40%] h-[400px] w-[400px] rounded-full bg-pink-500/5 mix-blend-screen blur-[100px]" />
      </div>

      {/* Grid Pattern Overlay */}
      <div className="pointer-events-none fixed inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCI+PHBhdGggZD0iTTAgMGgyNHYyNEgweiIgZmlsbD0ibm9uZSIvPjxwYXRoIGQ9Ik0wIG0gMGgyNHYxSDB6bTAgMjNoMjR2MUgweiIgZmlsbD0icmdiYSgyNTUsIDI1NSwgMjU1LCAwLjAxKSIvPjxwYXRoIGQ9Ik0wIG0gdjI0SDF2LTI0em0yMyAwdjI0aDF2LTI0eiIgZmlsbD0icmdiYSgyNTUsIDI1NSwgMjU1LCAwLjAxKSIvPjwvc3ZnPg==')] opacity-50" />

      {/* Auth header */}
      <header className="absolute left-0 right-0 top-0 z-50 mx-auto flex w-full max-w-7xl justify-between px-6 py-6 sm:px-10">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/5 text-white ring-1 ring-white/10 backdrop-blur-md">
            <HomeDarkSvg className="h-full w-full [&>svg]:h-full [&>svg]:w-full" />          </div>
          <span className="text-xl font-bold tracking-tight text-white">Ralph Meet</span>
        </div>
        <div className="flex items-center gap-4">
          <SignedOut>
            <SignInButton
              mode="modal"
              forceRedirectUrl="/"
              appearance={clerkAppearance}
            >
              <button className="group relative overflow-hidden rounded-full bg-white px-5 py-2 text-sm font-bold text-black shadow-[0_0_20px_rgba(255,255,255,0.2)] transition-all duration-300 hover:scale-105 active:scale-95">
                <span className="relative z-10">Sign In</span>
              </button>
            </SignInButton>
          </SignedOut>
          <SignedIn>
            <div className="rounded-full bg-white/[0.05] p-1 shadow-[0_4px_24px_-8px_rgba(0,0,0,0.5)] ring-1 ring-white/10 backdrop-blur-xl transition-all hover:bg-white/[0.1] hover:ring-white/20">
              <UserButton
                appearance={{
                  ...clerkAppearance,
                  elements: {
                    ...clerkAppearance.elements,
                    avatarBox: { width: 36, height: 36 },
                  },
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
            </div>
          </SignedIn>
        </div>
      </header>

      <main className="relative z-10 flex w-full flex-col items-center">
        {/* Hero Section */}
        <section className="flex min-h-[90vh] w-full flex-col items-center justify-center px-4 pb-16 pt-32 text-center sm:px-8">
          <h1 className="mb-8 max-w-5xl text-5xl font-black uppercase leading-[1.05] tracking-tighter text-white drop-shadow-[0_4px_24px_rgba(0,0,0,0.5)] sm:text-7xl md:text-[5.5rem] lg:text-[7rem]">
            Imagine a <br className="hidden md:block" />
            <span className="bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400 bg-clip-text text-transparent drop-shadow-[0_0_30px_rgba(168,85,247,0.4)]">
              better place
            </span>
          </h1>

          <p className="mb-14 max-w-3xl text-center text-lg font-medium leading-relaxed text-white/70 drop-shadow-sm md:text-xl md:leading-loose">
            ...where you can belong to a coding club, a gaming group, or a worldwide art community. Where just you and a handful of friends can spend time together. A place that makes it easy to talk every day and hang out more often.
          </p>

          <div className="flex w-full max-w-md flex-col items-center gap-4 sm:max-w-xl sm:flex-row sm:justify-center">
            <button
              onClick={createRoom}
              className="group relative flex w-full shrink-0 items-center justify-center gap-3 overflow-hidden rounded-full bg-white px-8 py-4 text-lg font-bold text-black shadow-[0_8px_30px_-8px_rgba(255,255,255,0.5)] transition-all duration-300 hover:scale-[1.02] hover:shadow-[0_12px_40px_-10px_rgba(255,255,255,0.7)] active:scale-[0.98] sm:w-auto sm:flex-1"
            >
              <Sparkles className="h-5 w-5 transition-transform duration-300 group-hover:scale-110" />
              <span className="relative z-10 whitespace-nowrap">New Meeting</span>
            </button>

            <SignedIn>
              <button
                onClick={() => navigate({ to: "/chat" })}
                className="group relative flex w-full shrink-0 items-center justify-center gap-3 overflow-hidden rounded-full bg-black/40 px-8 py-4 text-lg font-bold text-white shadow-[0_8px_30px_-8px_rgba(0,0,0,0.3)] ring-1 ring-white/10 backdrop-blur-xl transition-all duration-300 hover:bg-black/60 hover:ring-white/20 active:scale-[0.98] sm:w-auto sm:flex-1"
              >
                <div className="absolute inset-0 translate-x-[-100%] bg-gradient-to-r from-transparent via-white/5 to-transparent transition-transform duration-700 ease-in-out group-hover:translate-x-[100%]" />
                <MessageSquare className="h-5 w-5 transition-transform duration-300 group-hover:scale-110" />
                <span className="relative z-10 whitespace-nowrap">Open Chat</span>
              </button>
            </SignedIn>
          </div>
        </section>

        {/* Z-Pattern Content Blocks */}

        {/* Block 1: Left Text, Right Graphic */}
        <section className="flex w-full items-center justify-center border-t border-white/[0.05] bg-black/20 px-6 py-24 backdrop-blur-sm sm:px-12 md:py-32">
          <div className="flex w-full max-w-6xl flex-col items-center gap-16 md:flex-row lg:gap-24">
            <div className="flex w-full flex-1 flex-col items-start text-left">
              <h2 className="mb-6 text-4xl font-extrabold tracking-tight text-white md:text-5xl lg:text-6xl">
                Create an invite-only place where you belong
              </h2>
              <p className="text-lg leading-relaxed text-white/70 md:text-xl">
                Ralph Meet rooms are organized into topic-based channels where you can collaborate, share your screen, and just talk about your day without clogging up a group chat.
              </p>
            </div>

            <div className="w-full flex-1">
              <div className="relative aspect-square w-full overflow-hidden rounded-[2rem] border border-white/5 bg-gradient-to-br from-indigo-500/10 to-purple-500/10 p-6 shadow-2xl ring-1 ring-white/10 lg:aspect-[4/3]">
                {/* Fake UI Structure */}
                <div className="flex h-full w-full rounded-xl border border-white/10 bg-black/40 shadow-inner backdrop-blur-md">
                  <div className="w-1/3 border-r border-white/5 bg-white/[0.02] p-4">
                    <div className="mb-4 h-4 w-1/2 rounded bg-white/10"></div>
                    <div className="flex flex-col gap-3">
                      <div className="flex items-center gap-2 rounded bg-white/10 px-2 py-1.5"><Users2 className="h-4 w-4 text-white/50" /><div className="h-3 w-3/4 rounded bg-white/20"></div></div>
                      <div className="flex items-center gap-2 px-2 py-1.5"><Users2 className="h-4 w-4 text-white/30" /><div className="h-3 w-1/2 rounded bg-white/10"></div></div>
                      <div className="flex items-center gap-2 px-2 py-1.5"><Users2 className="h-4 w-4 text-white/30" /><div className="h-3 w-2/3 rounded bg-white/10"></div></div>
                    </div>
                  </div>
                  <div className="flex flex-1 flex-col p-4">
                    <div className="mb-4 h-6 w-1/3 rounded bg-white/10"></div>
                    <div className="flex-1 space-y-4">
                      <div className="flex gap-3">
                        <div className="h-8 w-8 shrink-0 rounded-full bg-indigo-500/40"></div>
                        <div className="space-y-2"><div className="h-3 w-24 rounded bg-white/20"></div><div className="h-3 w-48 rounded bg-white/10"></div></div>
                      </div>
                      <div className="flex gap-3">
                        <div className="h-8 w-8 shrink-0 rounded-full bg-purple-500/40"></div>
                        <div className="space-y-2"><div className="h-3 w-16 rounded bg-white/20"></div><div className="h-3 w-64 rounded bg-white/10"></div><div className="h-3 w-32 rounded bg-white/10"></div></div>
                      </div>
                    </div>
                    <div className="mt-4 h-10 w-full rounded-lg bg-white/5"></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Block 2: Left Graphic, Right Text */}
        <section className="flex w-full items-center justify-center bg-transparent px-6 py-24 sm:px-12 md:py-32">
          <div className="flex w-full max-w-6xl flex-col-reverse items-center gap-16 md:flex-row lg:gap-24">
            <div className="w-full flex-1">
              <div className="relative aspect-square w-full overflow-hidden rounded-[2rem] border border-white/5 bg-gradient-to-br from-teal-500/10 to-emerald-500/10 p-6 shadow-2xl ring-1 ring-white/10 lg:aspect-[4/3]">
                {/* Fake UI Structure */}
                <div className="relative flex h-full w-full flex-col overflow-hidden rounded-xl border border-white/10 bg-black/40 p-4 shadow-inner backdrop-blur-md">
                  <div className="mb-4 flex items-center gap-2">
                    <Headphones className="h-5 w-5 text-emerald-400" />
                    <div className="h-4 w-32 rounded bg-white/20"></div>
                  </div>
                  <div className="grid flex-1 grid-cols-2 gap-3">
                    <div className="flex flex-col items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/10 ring-1 ring-emerald-500/20">
                      <div className="relative h-16 w-16 rounded-full bg-emerald-500/20 ring-2 ring-emerald-400">
                        <div className="absolute -bottom-1 -right-1 h-5 w-5 rounded-full border-2 border-black bg-emerald-500"></div>
                      </div>
                      <div className="mt-3 h-3 w-16 rounded bg-emerald-100/50"></div>
                    </div>
                    <div className="flex flex-col items-center justify-center rounded-lg border border-white/5 bg-white/5">
                      <div className="h-16 w-16 rounded-full bg-white/10"></div>
                      <div className="mt-3 h-3 w-20 rounded bg-white/20"></div>
                    </div>
                    <div className="flex flex-col items-center justify-center rounded-lg border border-white/5 bg-white/5">
                      <div className="h-16 w-16 rounded-full bg-white/10"></div>
                      <div className="mt-3 h-3 w-12 rounded bg-white/20"></div>
                    </div>
                    <div className="flex flex-col items-center justify-center rounded-lg border border-white/5 bg-white/5">
                      <div className="h-16 w-16 rounded-full bg-white/10"></div>
                      <div className="mt-3 h-3 w-14 rounded bg-white/20"></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex w-full flex-1 flex-col items-start text-left">
              <h2 className="mb-6 text-4xl font-extrabold tracking-tight text-white md:text-5xl lg:text-6xl">
                Where hanging out is easy
              </h2>
              <p className="text-lg leading-relaxed text-white/70 md:text-xl">
                Grab a seat in a voice room when you're free. Friends in your space can see you're around and instantly pop in to talk without having to call.
              </p>
            </div>
          </div>
        </section>

        {/* Block 3: Left Text, Right Graphic */}
        <section className="relative flex w-full items-center justify-center overflow-hidden border-t border-white/[0.05] bg-black/20 px-6 py-24 backdrop-blur-sm sm:px-12 md:py-32">
          {/* Abstract glow for the edge network vibe */}
          <div className="absolute top-1/2 left-1/2 h-[500px] w-[500px] -translate-x-1/2 -translate-y-1/2 animate-pulse rounded-full bg-pink-500/10 blur-[150px]" />

          <div className="relative z-10 flex w-full max-w-6xl flex-col items-center gap-16 md:flex-row lg:gap-24">
            <div className="flex w-full flex-1 flex-col items-start text-left">
              <h2 className="mb-6 text-4xl font-extrabold tracking-tight text-white md:text-5xl lg:text-6xl">
                Reliable tech for staying close
              </h2>
              <p className="text-lg leading-relaxed text-white/70 md:text-xl">
                Powered by Cloudflare's ultra-low latency edge network. Your video and audio is routed through the fastest path on the planet. Feel like you’re in the same room, no matter where you are.
              </p>
            </div>

            <div className="w-full flex-1">
              <div className="relative aspect-square w-full overflow-hidden rounded-[2rem] border border-white/5 bg-gradient-to-br from-pink-500/10 to-orange-500/10 p-6 shadow-2xl ring-1 ring-white/10 lg:aspect-[4/3]">
                {/* Fake UI Structure */}
                <div className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-black/40 shadow-inner backdrop-blur-md">
                  {/* Node Graph Abstract */}
                  <Globe2 className="absolute h-64 w-64 text-pink-500/20 animate-[spin_60s_linear_infinite]" />
                  <div className="absolute flex h-full w-full items-center justify-center">
                    <div className="h-32 w-32 rounded-full border border-pink-500/30 ring-4 ring-pink-500/10"></div>
                    <div className="absolute h-48 w-48 rounded-full border border-pink-500/20"></div>
                    <div className="absolute h-64 w-64 rounded-full border border-pink-500/10"></div>
                  </div>

                  {/* Floating media tiles */}
                  <div className="absolute left-8 top-8 rounded-lg border border-white/10 bg-black/60 p-2 backdrop-blur-xl">
                    <Video className="h-6 w-6 text-pink-400" />
                  </div>
                  <div className="absolute bottom-12 right-12 rounded-lg border border-white/10 bg-black/60 p-2 backdrop-blur-xl">
                    <Activity className="h-6 w-6 text-orange-400" />
                  </div>
                  <div className="absolute bottom-1/3 left-1/4 h-2 w-2 animate-ping rounded-full bg-pink-500"></div>
                  <div className="absolute right-1/4 top-1/3 h-2 w-2 animate-ping rounded-full bg-orange-500" style={{ animationDelay: '1s' }}></div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Final CTA Section */}
        <section className="relative flex w-full flex-col items-center justify-center px-6 py-32 text-center">
          <h2 className="mb-10 text-4xl font-black uppercase tracking-tighter text-white sm:text-5xl md:text-6xl">
            Ready to start your journey?
          </h2>

          {/* Large Discord-style Join Form at bottom */}
          <form
            onSubmit={joinRoom}
            className="group flex w-full max-w-xl flex-col gap-2 rounded-[2.5rem] bg-black/40 p-2 shadow-[0_0_50px_-15px_rgba(0,0,0,0.6)] ring-1 ring-white/[0.05] backdrop-blur-2xl transition-all duration-300 focus-within:bg-black/60 focus-within:shadow-[0_0_60px_-15px_rgba(99,102,241,0.2)] focus-within:ring-indigo-500/50 sm:flex-row"
          >
            <div className="relative flex-1">
              <input
                type="text"
                value={room}
                onChange={(e) => setRoom(e.target.value)}
                placeholder="Enter room code or link..."
                spellCheck={false}
                autoComplete="off"
                className="h-full w-full rounded-full bg-transparent px-6 py-4 text-lg font-medium text-white outline-none transition-all placeholder:text-white/30"
              />
            </div>
            <button
              type="submit"
              disabled={!room.trim()}
              className="group/btn flex w-full shrink-0 items-center justify-center gap-2 rounded-full bg-indigo-500 px-8 py-4 font-bold text-white shadow-lg transition-all duration-300 hover:bg-indigo-400 disabled:pointer-events-none disabled:opacity-30 active:scale-[0.98] sm:w-auto"
            >
              <span className="text-lg">Join Room</span>
              <ArrowRight className="h-5 w-5 transition-transform duration-300 group-hover/btn:translate-x-1" />
            </button>
          </form>

          <p className="mt-8 text-sm font-medium text-white/40">
            Free forever. No credit card required.
          </p>
        </section>
      </main>

      {/* Footer */}
      <footer className="relative z-10 w-full border-t border-white/[0.05] bg-black/40 px-6 py-12 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-7xl flex-col items-center justify-between gap-6 sm:flex-row">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/5 text-white ring-1 ring-white/10">
              <HomeDarkSvg className="h-full w-full [&>svg]:h-full [&>svg]:w-full" />
            </div>
            <span className="text-sm font-bold tracking-tight text-white">Ralph Meet</span>
          </div>
          <p className="text-center text-sm font-medium text-white/40">
            Built with <span className="text-white/70">Cloudflare Realtime SFU</span>
          </p>
        </div>
      </footer>

      {profileOpen && <SettingsModal onClose={() => setProfileOpen(false)} />}

      <style>{`
        @keyframes float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-8px); }
        }
      `}</style>
    </div>
  );
}
