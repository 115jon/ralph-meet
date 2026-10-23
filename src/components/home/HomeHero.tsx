import { Icon } from "@/components/ui/icon";
import {
  motion,
  useMotionTemplate,
  useReducedMotion,
  useScroll,
  useTransform,
} from "framer-motion";
import { useRef } from "react";
import { LandingField } from "./LandingField";
import { CONTAINER, CTA_PRIMARY, CTA_SECONDARY } from "./ui";

export interface HomeHeroProps {
  onStartRoom: () => void;
  isSignedIn: boolean;
  isWindows: boolean;
  downloadUrl: string;
}

/**
 * First viewport. The copy is plain server-rendered text (no hidden initial
 * state), the field mounts behind it after first paint, and scrolling drives
 * three things from one progress value: the field's sweep and dimming, a
 * slow lift of the copy, and its fade. Under reduced motion the field renders
 * one frame and the copy stays put.
 */
export function HomeHero({
  onStartRoom,
  isSignedIn,
  isWindows,
  downloadUrl,
}: HomeHeroProps) {
  const ref = useRef<HTMLElement>(null);
  const reduceMotion = useReducedMotion() ?? false;
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end start"],
  });
  const lift = useTransform(scrollYProgress, [0, 1], [0, -120]);
  const copyOpacity = useTransform(scrollYProgress, [0, 0.55], [1, 0]);
  const transform = useMotionTemplate`translate3d(0, ${lift}px, 0)`;

  const secondary = isSignedIn ? (
    <a href="/chat" className={CTA_SECONDARY}>
      <Icon name="chat" size="sm" />
      Open the app
    </a>
  ) : isWindows ? (
    <a href={downloadUrl} className={CTA_SECONDARY}>
      <Icon name="download" size="sm" />
      Download for Windows
    </a>
  ) : (
    <a href="#join" className={CTA_SECONDARY}>
      Join with a code
    </a>
  );

  return (
    <section
      ref={ref}
      id="home-hero"
      aria-labelledby="home-hero-title"
      className="relative isolate flex min-h-dvh flex-col overflow-hidden"
    >
      <LandingField
        interactive
        fade="both"
        tone="full"
        cell={5}
        contrast={1.4}
        progress={reduceMotion ? undefined : scrollYProgress}
      />

      <motion.div
        style={reduceMotion ? undefined : { transform, opacity: copyOpacity }}
        className={`${CONTAINER} relative z-10 flex flex-1 flex-col items-center justify-center pb-24 pt-32 text-center`}
      >
        <div className="rm-home-hero-copy flex flex-col items-center">
          <h1
            id="home-hero-title"
            className="rm-home-h1 rm-home-enter max-w-[11ch] text-balance font-display text-rm-text"
          >
            The room is always open.
          </h1>
          <p
            className="rm-home-lede rm-home-enter mt-6 max-w-[40ch] text-pretty text-rm-text-secondary md:mt-8"
            style={{ "--enter-delay": "80ms" } as React.CSSProperties}
          >
            Voice, chat and video for the people you talk to every day. Start a
            room, send the link, they&rsquo;re in.
          </p>
          <div
            className="rm-home-enter mt-8 flex flex-col items-stretch gap-3 md:mt-10 md:flex-row md:items-center"
            style={{ "--enter-delay": "160ms" } as React.CSSProperties}
          >
            <button type="button" onClick={onStartRoom} className={CTA_PRIMARY}>
              Start a room
              <Icon name="arrowRight" size="sm" />
            </button>
            {secondary}
          </div>
        </div>
      </motion.div>
    </section>
  );
}
