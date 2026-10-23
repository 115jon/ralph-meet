import { Icon } from "@/components/ui/icon";
import { LandingField } from "./LandingField";
import type { DesktopRelease } from "./releases";
import { Shot } from "./Shot";
import { CONTAINER, CTA_PRIMARY, CTA_SECONDARY } from "./ui";

export interface HomePlatformsProps {
  release: DesktopRelease;
  isSignedIn: boolean;
}

/**
 * Second field moment: a quiet, still version of the hero's dither sits
 * behind the platform split, so the page returns to its material once
 * before the close. The phone frame on the right is the real responsive
 * app at 390 wide.
 */
export function HomePlatforms({ release, isSignedIn }: HomePlatformsProps) {
  return (
    <section
      id="download"
      aria-labelledby="home-platforms-title"
      className="relative isolate scroll-mt-16 overflow-hidden border-t border-rm-border"
    >
      <LandingField
        still
        tone="quiet"
        cell={6}
        seed={23}
        contrast={1.15}
        intensity={0.5}
        opacity={0.85}
      />
      <div
        className={`${CONTAINER} relative z-10 grid items-center gap-16 py-24 lg:grid-cols-[minmax(0,6fr)_minmax(0,6fr)] lg:py-32`}
      >
        <div className="max-w-[44ch]">
          <h2
            id="home-platforms-title"
            data-reveal
            className="rm-home-h2 text-balance font-display text-rm-text"
          >
            On your desk. In your pocket.
          </h2>
          <p
            data-reveal
            data-reveal-delay="60"
            className="rm-home-lede mt-6 text-pretty text-rm-text-secondary"
          >
            Ralph Meet runs in your browser and as a Windows app, with the same
            rooms and the same account everywhere.
          </p>
          <div
            data-reveal
            data-reveal-delay="120"
            className="mt-8 flex flex-col items-start gap-3 md:flex-row md:items-center"
          >
            <a href={release.downloadUrl} className={CTA_PRIMARY}>
              <Icon name="download" size="sm" />
              Download for Windows
            </a>
            <a
              href={isSignedIn ? "/chat" : "/sign-in"}
              className={CTA_SECONDARY}
            >
              Open in the browser
            </a>
          </div>
          <p
            data-reveal
            data-reveal-delay="160"
            className="mt-4 text-ui-xs text-rm-text-muted"
          >
            {release.name}, {release.fileName}. Windows 10 and later.
          </p>
        </div>

        <figure
          data-reveal
          data-reveal-delay="100"
          className="justify-self-center lg:justify-self-end"
        >
          <div className="w-[260px] overflow-hidden rounded-3xl border border-rm-border bg-rm-bg-surface shadow-lg md:w-[300px]">
            <Shot
              name="phone-chat"
              alt="Ralph Meet on a phone: a text channel with messages, a link preview and the composer"
              width={390}
              height={844}
              sizes="300px"
            />
          </div>
        </figure>
      </div>
    </section>
  );
}
