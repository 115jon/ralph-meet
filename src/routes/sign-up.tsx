import { AUTH_CARD_APPEARANCE } from "@/components/auth/auth-card-appearance";
import { AuthSplitLayout } from "@/components/auth/AuthSplitLayout";
import DesktopLogin from "@/components/DesktopLogin";
import {
  buildAuthRouteUrl,
  buildPostAuthSignInUrl,
} from "@/lib/auth-route-urls";
import { isTauri } from "@/lib/platform";
import { SignUp } from "@kova/react";
import { createFileRoute } from "@tanstack/react-router";

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
        content:
          "Create a Ralph Meet account to access persistent chats, servers, and channels.",
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
  const afterSignUpUrl = buildPostAuthSignInUrl(
    afterSignUpTarget,
    native_handoff,
  );
  const signInUrl = buildAuthRouteUrl("/sign-in", {
    redirect_url,
    native_handoff,
  });

  return (
    <AuthSplitLayout>
      <SignUp
        afterSignUpUrl={afterSignUpUrl}
        signInUrl={signInUrl}
        appearance={AUTH_CARD_APPEARANCE}
      />
    </AuthSplitLayout>
  );
}
