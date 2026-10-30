/**
 * The splash for route loads, sign-in and the desktop app: the cold-load
 * screen (ColdLoad) held at its first step, so when the chat's connection
 * overlay takes over, the mark and the status line are already where they
 * stay (same component, same size, same place) and nothing flashes. The
 * mark is still at step 0; nothing loops. If it is still up after 10 s it
 * says so and offers Reload.
 */

import { ColdLoadScreen } from "@/components/chat/ColdLoad";
import { LOADER_SETTLE_MS, useElapsed } from "@/components/ui/LoadingScreen";

export function SplashScreen() {
  const slow = useElapsed(LOADER_SETTLE_MS);
  return (
    <ColdLoadScreen
      step={0}
      error={slow ? "slow" : null}
      onReload={() => window.location.reload()}
      className="h-full min-h-dvh w-full"
    />
  );
}
