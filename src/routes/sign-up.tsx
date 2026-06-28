import DesktopLogin from "@/components/DesktopLogin";
import { buildAuthRouteUrl, buildPostAuthSignInUrl } from "@/lib/auth-route-urls";
import { isTauri } from "@/lib/platform";
import { SignUp } from "@kova/react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Radio } from "lucide-react";

type SignUpSearch = {
  redirect_url?: string;
  native_handoff?: string;
};

export const Route = createFileRoute("/sign-up")({
  validateSearch: (search: Record<string, unknown>): SignUpSearch => {
    return {
      redirect_url: search.redirect_url as string | undefined,
      native_handoff: search.native_handoff as string | undefined,
    };
  },
  component: SignUpPage,
  head: () => ({
    meta: [
      { title: "Sign Up — Ralph Meet" },
      {
        name: "description",
        content: "Create a Ralph Meet account to access persistent chats, servers, and channels.",
      },
    ],
  }),
});

function SignUpPage() {
  if (isTauri()) {
    return <DesktopLogin />;
  }

  return <WebSignUpPage />;
}

function WebSignUpPage() {
  const { redirect_url, native_handoff } = Route.useSearch();
  const afterSignUpTarget = redirect_url || "/chat";
  const afterSignUpUrl = buildPostAuthSignInUrl(afterSignUpTarget, native_handoff);
  const signInUrl = buildAuthRouteUrl("/sign-in", { redirect_url, native_handoff });

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[var(--rm-bg-primary)] px-6 selection:bg-rm-accent/30">
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden">
        <div className="absolute left-[-10%] top-[-10%] h-[600px] w-[600px] animate-pulse rounded-full bg-rm-accent/10 mix-blend-screen blur-[120px]" style={{ animationDuration: "8s" }} />
        <div className="absolute bottom-[-10%] right-[-10%] h-[600px] w-[600px] animate-pulse rounded-full bg-primary/5 mix-blend-screen blur-[120px]" style={{ animationDuration: "10s" }} />
        <div className="absolute bottom-[20%] left-[20%] h-[400px] w-[400px] rounded-full bg-rm-accent/5 mix-blend-screen blur-[100px]" />
      </div>

      <div className="pointer-events-none absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCI+PHBhdGggZD0iTTAgMGgyNHYyNEgweiIgZmlsbD0ibm9uZSIvPjxwYXRoIGQ9Ik0wIG0gMGgyNHYxSDB6bTAgMjNoMjR2MUgweiIgZmlsbD0icmdiYSgyNTUsIDI1NSwgMjU1LCAwLjAxKSIvPjxwYXRoIGQ9Ik0wIG0gdjI0SDF2LTI0em0yMyAwdjI0aDF2LTI0eiIgZmlsbD0icmdiYSgyNTUsIDI1NSwgMjU1LCAwLjAxKSIvPjwvc3ZnPg==')] opacity-50" />

      <main className="relative z-10 flex w-full max-w-[420px] flex-col items-center gap-8">
        <Link to="/" className="group flex flex-col items-center gap-4 rounded-3xl no-underline outline-none hover:no-underline focus-visible:ring-2 focus-visible:ring-rm-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-black">
          <div className="relative flex h-20 w-20 animate-[float_4s_ease-in-out_infinite] items-center justify-center rounded-[1.5rem] bg-rm-bg-elevated/40 border border-rm-border shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] transition-all duration-500 group-hover:scale-105 group-hover:border-rm-accent/50 group-hover:shadow-[0_0_30px_-5px_var(--rm-accent)]">
            <div className="absolute inset-0 rounded-[1.5rem] bg-gradient-to-br from-white/5 to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
            <Radio className="relative z-10 h-8 w-8 text-rm-accent transition-colors duration-300 group-hover:text-rm-accent-hover" />
          </div>
          <h1 className="bg-gradient-to-b from-white to-white/70 bg-clip-text text-2xl font-extrabold tracking-tight text-transparent drop-shadow-sm transition-opacity duration-300 group-hover:opacity-90">
            Ralph Meet
          </h1>
        </Link>

        <div className="relative w-full">
          <div className="pointer-events-none absolute -inset-1 rounded-[2rem] bg-rm-accent/10 opacity-0 blur-xl transition-opacity duration-500 group-hover:opacity-100" />
          <SignUp afterSignUpUrl={afterSignUpUrl} signInUrl={signInUrl} />
        </div>
      </main>

      <footer className="fixed bottom-0 left-0 right-0 p-6 text-center text-[0.65rem] font-bold uppercase tracking-widest text-rm-text-ghost">
        Built with Cloudflare Realtime SFU
      </footer>
    </div>
  );
}
