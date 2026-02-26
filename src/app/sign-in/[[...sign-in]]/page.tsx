import { SignIn } from "@clerk/nextjs";
import { Radio } from "lucide-react";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign In — Ralph Meet",
  description: "Sign in to Ralph Meet to start communicating in real-time.",
};

export default function SignInPage() {
  return (
    <div className="relative flex min-h-screen items-center justify-center bg-[var(--rm-bg-primary)]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(59,130,246,0.08)_0%,transparent_60%)]" />
      <div className="relative z-10 flex flex-col items-center gap-8">
        <div className="flex flex-col items-center gap-3 text-center">
          <Radio className="h-10 w-10 text-blue-400" />
          <h1 className="text-3xl font-bold text-rm-text-primary">Ralph Meet</h1>
          <p className="max-w-xs text-sm text-rm-text-muted">
            Sign in to create and join real-time meetings
          </p>
        </div>
        <SignIn />
      </div>
    </div>
  );
}
