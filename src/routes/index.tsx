import DesktopLogin from "@/components/DesktopLogin";
import HomePageClient from "@/components/HomePageClient";
import { isTauri } from "@/lib/platform";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: HomePage,
  head: () => ({
    meta: [
      { title: "Ralph Meet — Real-Time Video Conferencing" },
      {
        name: "description",
        content:
          "Real-time video, audio & screen sharing powered by Cloudflare Realtime SFU. Connect with anyone, anywhere.",
      },
    ],
  }),
});

function HomePage() {
  // Desktop app: show a clean sign-in page instead of the landing page
  if (isTauri()) {
    return <DesktopLogin />;
  }
  return <HomePageClient />;
}
