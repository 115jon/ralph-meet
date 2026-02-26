import HomePageClient from "@/components/HomePageClient";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Ralph Meet — Real-Time Video Conferencing",
  description: "Real-time video, audio & screen sharing powered by Cloudflare Realtime SFU. Connect with anyone, anywhere.",
};

export default function HomePage() {
  return <HomePageClient />;
}
