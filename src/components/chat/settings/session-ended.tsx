import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

/** A 401 from the API: the session is gone, so retrying can't work. */
export function isSessionEnded(error: unknown): boolean {
  return (
    Boolean(error) &&
    typeof error === "object" &&
    (error as { status?: unknown }).status === 401
  );
}

/** Sign in, then come back to where you were. */
export function signInAgain() {
  if (typeof window === "undefined") return;
  const back = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  window.location.assign(`/sign-in?redirect_url=${encodeURIComponent(back)}`);
}

/**
 * The recovery under a failed load: "Sign in again" (primary) when the
 * session has ended, otherwise "Try again".
 */
export function RecoverButton({
  sessionEnded,
  onRetry,
  loading = false,
}: {
  sessionEnded: boolean;
  onRetry: () => void;
  loading?: boolean;
}) {
  if (sessionEnded) {
    return (
      <Button type="button" variant="primary" size="sm" onClick={signInAgain}>
        Sign in again
      </Button>
    );
  }
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      loading={loading}
      onClick={onRetry}
    >
      <Icon name="refresh" size="sm" />
      Try again
    </Button>
  );
}
