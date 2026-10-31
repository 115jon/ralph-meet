import { AUTH_CARD_APPEARANCE } from "@/components/auth/auth-card-appearance";
import { AuthSplitLayout } from "@/components/auth/AuthSplitLayout";
import { LazyDesktopLogin } from "@/components/LazyDesktopLogin";
import {
  buildAuthRouteUrl,
  buildPostAuthSignInUrl,
  redirectOrigins,
  sanitizeRedirectUrl,
} from "@/lib/auth-route-urls";
import { isTauri } from "@/lib/platform";
import { SignUp } from "@kova/react";
import { createFileRoute } from "@tanstack/react-router";

type SignUpSearch = {
  redirect_url?: string;
};

export const Route = createFileRoute("/sign-up")({
  validateSearch: (search: Record<string, unknown>): SignUpSearch => {
    return {
      redirect_url: search.redirect_url as string | undefined,
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
    return <LazyDesktopLogin />;
  }

  return <WebSignUpPage />;
}

function WebSignUpPage() {
  const { redirect_url } = Route.useSearch();
  const afterSignUpTarget = sanitizeRedirectUrl(
    redirect_url,
    redirectOrigins(),
  );
  const afterSignUpUrl = buildPostAuthSignInUrl(afterSignUpTarget);
  const signInUrl = buildAuthRouteUrl("/sign-in", { redirect_url });

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
