import { Button } from "@/components/ui/button";
import { DitherRule, DitherWord } from "@/components/ui/dither";
import { Icon } from "@/components/ui/icon";
import { DitherHorizon } from "./HomeDither";
import { KeyLink } from "./Keys";
import { ResponsiveShot } from "./Shot";
import { CONTAINER, DISPLAY_H1, LEDE } from "./ui";

export interface HomeHeroProps {
  onStartRoom: () => void;
  isSignedIn: boolean;
  isWindows: boolean;
  downloadUrl: string;
}

const MANIFEST: [string, string][] = [
  ["Platform", "Windows, web, phone"],
  ["Audio", "Opus, noise suppression"],
  ["Host", "None. The room stays open"],
];

/**
 * The poster (type-mockups variant C). A Bricolage 800 headline set edge to
 * edge with its last word printed in two accent inks, a 20px dithered rule
 * under it, then three columns: the lede, the keys, and a silkscreen
 * manifest. The real product stands on a still dithered horizon below; the
 * horizon starts under the screenshot, so no line of text sits on dither.
 * Everything is server-rendered and visible; nothing here animates.
 */
export function HomeHero({
  onStartRoom,
  isSignedIn,
  isWindows,
  downloadUrl,
}: HomeHeroProps) {
  const secondary = isSignedIn ? (
    <KeyLink href="/chat" paired>
      <Icon name="chat" size="sm" />
      Open the app
    </KeyLink>
  ) : isWindows ? (
    <KeyLink href={downloadUrl} paired>
      <Icon name="download" size="sm" />
      Download for Windows
    </KeyLink>
  ) : (
    <KeyLink href="#join" paired>
      Join with a code
    </KeyLink>
  );

  return (
    <section
      id="home-hero"
      aria-labelledby="home-hero-title"
      className="relative overflow-hidden"
    >
      <div className={`${CONTAINER} pt-[104px] md:pt-[136px]`}>
        <h1 id="home-hero-title" className={DISPLAY_H1}>
          The room is <br className="max-sm:hidden" />
          always{" "}
          <DitherWord ground="ply-0" cell={3}>
            open.
          </DitherWord>
        </h1>
        <DitherRule cell={3} className="mt-8 h-3 md:mt-12 md:h-5" />
        <div className="mt-8 grid gap-8 md:grid-cols-12 md:gap-6">
          <p className={`${LEDE} max-w-[32ch] md:col-span-4`}>
            Start a room, send the link, they&rsquo;re in. Voice, chat and
            screen share that stay up all evening.
          </p>
          <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-start md:col-span-4">
            <Button size="lg" onClick={onStartRoom}>
              Start a room
              <Icon name="arrowRight" size="sm" />
            </Button>
            {secondary}
          </div>
          <ul className="silkscreen flex flex-col gap-2 text-ink-3 md:col-span-4 md:items-end md:text-right">
            <li>Voice, chat and video for your people</li>
            {MANIFEST.map(([k, v]) => (
              <li key={k}>
                <span className="text-ink-2">{k}</span> · {v}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="relative mt-12 md:mt-20">
        <DitherHorizon className="absolute inset-x-0 top-[30%] bottom-0" />
        <figure className={`${CONTAINER} relative max-md:pb-14`}>
          <ResponsiveShot
            desktop={{
              name: "voice",
              alt: "Ralph Meet on the desktop: the Lounge voice channel with four people on tiles, the channel tree listing who is in the call with Linus lit as talking, and the call controls below",
              width: 1440,
              height: 900,
            }}
            phone={{
              name: "phone-voice",
              alt: "Ralph Meet on a phone: the Lounge voice channel with four people on tiles, Linus lit as talking, and the call controls along the bottom",
              width: 390,
              height: 844,
            }}
            className="md:rounded-b-none md:border-b-0"
            phoneClassName="max-w-[280px]"
            sizes="(min-width: 1440px) 1360px, 92vw"
          />
        </figure>
      </div>
    </section>
  );
}
