import { useClerkAppearance } from "@/hooks/useClerkAppearance";
import { SignIn } from "@clerk/tanstack-react-start";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Radio } from "lucide-react";

export const Route = createFileRoute("/sign-in")({
  component: SignInPage,
  head: () => ({
    meta: [
      { title: "Sign In — Ralph Meet" },
      {
        name: "description",
        content: "Sign in to Ralph Meet to access your servers and channels.",
      },
    ],
  }),
});

function SignInPage() {
  const clerkAppearance = useClerkAppearance();

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[var(--rm-bg-primary)] px-6 selection:bg-indigo-500/30">
      {/* Premium Orb Background */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden">
        <div className="absolute top-[-10%] left-[-10%] h-[600px] w-[600px] animate-pulse rounded-full bg-indigo-500/10 mix-blend-screen blur-[120px]" style={{ animationDuration: '8s' }} />
        <div className="absolute bottom-[-10%] right-[-10%] h-[600px] w-[600px] animate-pulse rounded-full bg-purple-500/10 mix-blend-screen blur-[120px]" style={{ animationDuration: '10s' }} />
        <div className="absolute bottom-[20%] left-[20%] h-[400px] w-[400px] rounded-full bg-pink-500/5 mix-blend-screen blur-[100px]" />
      </div>

      {/* Grid Pattern Overlay */}
      <div className="pointer-events-none absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCI+PHBhdGggZD0iTTAgMGgyNHYyNEgweiIgZmlsbD0ibm9uZSIvPjxwYXRoIGQ9Ik0wIG0gMGgyNHYxSDB6bTAgMjNoMjR2MUgweiIgZmlsbD0icmdiYSgyNTUsIDI1NSwgMjU1LCAwLjAxKSIvPjxwYXRoIGQ9Ik0wIG0gdjI0SDF2LTI0em0yMyAwdjI0aDF2LTI0eiIgZmlsbD0icmdiYSgyNTUsIDI1NSwgMjU1LCAwLjAxKSIvPjwvc3ZnPg==')] opacity-50" />

      <main className="relative z-10 flex w-full max-w-[420px] flex-col items-center gap-8">
        {/* Logo */}
        <Link to="/" className="group flex flex-col items-center gap-4 no-underline outline-none hover:no-underline focus-visible:ring-2 focus-visible:ring-indigo-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-black rounded-3xl">
          <div className="relative flex h-20 w-20 items-center justify-center rounded-[1.5rem] bg-gradient-to-br from-indigo-500/10 to-purple-500/10 shadow-[inset_0_1px_1px_rgba(255,255,255,0.1),0_0_40px_-10px_rgba(99,102,241,0.2)] ring-1 ring-white/10 transition-transform duration-500 group-hover:scale-105 group-hover:shadow-[inset_0_1px_1px_rgba(255,255,255,0.2),0_0_60px_-15px_rgba(99,102,241,0.4)] animate-[float_4s_ease-in-out_infinite]">
            <div className="absolute inset-0 rounded-[1.5rem] bg-gradient-to-br from-white/5 to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
            <Radio className="relative z-10 h-8 w-8 text-indigo-400 drop-shadow-[0_0_15px_rgba(99,102,241,0.5)] transition-colors duration-300 group-hover:text-indigo-300" />
          </div>
          <h1 className="bg-gradient-to-b from-white to-white/70 bg-clip-text text-2xl font-extrabold tracking-tight text-transparent drop-shadow-sm transition-opacity duration-300 group-hover:opacity-90">
            Ralph Meet
          </h1>
        </Link>

        {/* Clerk SignIn component container */}
        <div className="w-full relative">
          {/* Subtle glow behind the sign-in form */}
          <div className="pointer-events-none absolute -inset-1 rounded-[2rem] bg-gradient-to-br from-indigo-500/20 to-purple-500/20 opacity-0 blur-xl transition-opacity duration-500 group-hover:opacity-100" />
          <SignIn routing="hash" appearance={clerkAppearance} />
        </div>
      </main>

      <footer className="fixed bottom-0 left-0 right-0 p-6 text-center text-[0.65rem] font-bold tracking-widest uppercase text-rm-text-ghost">
        Built with Cloudflare Realtime SFU
      </footer>
    </div>
  );
}
