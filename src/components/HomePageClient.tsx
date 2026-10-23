/**
 * Public landing page (web only; Tauri shows DesktopLogin instead).
 *
 * Sections, top to bottom: header, hero over the interactive dither field,
 * the product stage (sticky rail, one feature per viewport), the kit ledger,
 * the platform split over a still field, the join-by-code close, footer.
 * Everything is server-rendered visible; motion is layered on after mount
 * (`./home/reveal`, the hero's scroll binding) and collapses to a calm
 * static page under reduced motion.
 */

import { HomeFooter } from "@/components/home/HomeFooter";
import { HomeHeader, SCROLL_SENTINEL_ID } from "@/components/home/HomeHeader";
import { HomeHero } from "@/components/home/HomeHero";
import { HomeJoin } from "@/components/home/HomeJoin";
import { HomeKit } from "@/components/home/HomeKit";
import { HomePlatforms } from "@/components/home/HomePlatforms";
import { HomeProduct } from "@/components/home/HomeProduct";
import {
  FALLBACK_RELEASES,
  fetchDesktopReleases,
  type DesktopRelease,
} from "@/components/home/releases";
import { useRevealOnScroll } from "@/components/home/reveal";
import { isWindows } from "@/lib/platform";
import { useAuth } from "@kova/react";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

const subscribeToStaticPlatform = () => () => {};
const getServerWindowsSnapshot = () => false;

function randomSlug(): string {
  return (
    Math.random().toString(36).substring(2, 8) +
    "-" +
    Math.random().toString(36).substring(2, 6)
  );
}

export default function HomePageClient() {
  const navigate = useNavigate();
  const { isSignedIn } = useAuth();
  const pageRef = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState("");
  const [releases, setReleases] = useState<DesktopRelease[]>(FALLBACK_RELEASES);
  const isWindowsUser = useSyncExternalStore(
    subscribeToStaticPlatform,
    () => isWindows(),
    getServerWindowsSnapshot,
  );

  useRevealOnScroll(pageRef);

  useEffect(() => {
    let cancelled = false;
    fetchDesktopReleases().then((mapped) => {
      if (!cancelled && mapped.length > 0) setReleases(mapped);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const latestRelease = releases[0] ?? FALLBACK_RELEASES[0]!;

  const createRoom = () => {
    navigate({ to: "/room/$slug", params: { slug: randomSlug() } });
  };

  const joinRoom = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = room.trim().toLowerCase().replace(/\s+/g, "-");
    if (trimmed) {
      navigate({ to: "/room/$slug", params: { slug: trimmed } });
    }
  };

  return (
    <div
      ref={pageRef}
      className="rm-home relative flex min-h-dvh flex-col bg-rm-bg-primary font-ui text-rm-text"
    >
      <a
        href="#home-hero-title"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-30 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-ui-sm focus:font-semibold focus:text-primary-foreground"
      >
        Skip to content
      </a>
      <div
        id={SCROLL_SENTINEL_ID}
        className="pointer-events-none absolute left-0 top-0 h-6 w-full"
        aria-hidden="true"
      />
      <HomeHeader />
      <main>
        <HomeHero
          onStartRoom={createRoom}
          isSignedIn={isSignedIn}
          isWindows={isWindowsUser}
          downloadUrl={latestRelease.downloadUrl}
        />
        <HomeProduct />
        <HomeKit />
        <HomePlatforms release={latestRelease} isSignedIn={isSignedIn} />
        <HomeJoin
          room={room}
          onRoomChange={setRoom}
          onJoin={joinRoom}
          onStartRoom={createRoom}
        />
      </main>
      <HomeFooter isSignedIn={isSignedIn} onStartRoom={createRoom} />
    </div>
  );
}
