import RoomPageClient from "@/components/RoomPageClient";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Meeting Room — Ralph Meet",
  description: "Join your real-time video meeting on Ralph Meet. Secure, high-quality audio and video for your team.",
};

export default function Page() {
  return <RoomPageClient />;
}
