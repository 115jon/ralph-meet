import HomePageClient from "@/components/HomePageClient";
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
  return <HomePageClient />;
}
