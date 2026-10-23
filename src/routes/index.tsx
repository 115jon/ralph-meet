import DesktopLogin from "@/components/DesktopLogin";
import HomePageClient from "@/components/HomePageClient";
import { isTauri } from "@/lib/platform";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: HomePage,
  head: () => ({
    meta: [
      { title: "Ralph Meet: voice, chat and video rooms" },
      {
        name: "description",
        content:
          "Voice, chat, video and screen share for the people you talk to every day. Start a room, send the link, they're in. Runs on Cloudflare's edge.",
      },
    ],
  }),
});

function HomePage() {
  // Local app: show browser-based sign-in page for native auth
  if (isTauri()) {
    return <DesktopLogin />;
  }
  return <HomePageClient />;
}
