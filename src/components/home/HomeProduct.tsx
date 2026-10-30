import { DitherWord } from "@/components/ui/dither";
import { Icon } from "@/components/ui/icon";
import { Led } from "@/components/ui/led";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";
import { ResponsiveShot, Shot, WindowShot } from "./Shot";
import {
  BODY,
  CONTAINER,
  DISPLAY_H2,
  DISPLAY_H3,
  FACT_TITLE,
  KICKER,
  LEDE,
  NUMERAL,
  RULE_COLUMN,
} from "./ui";

/**
 * A feature's poster head: the oversized dithered numeral (decorative), a
 * silkscreen kicker, then the Bricolage head. `size="sm"` sets the head a
 * step down for the narrow two-up columns.
 */
function FeatureHead({
  index,
  kicker,
  id,
  title,
  size = "lg",
  className,
}: {
  index: string;
  kicker: string;
  id: string;
  title: string;
  size?: "lg" | "sm";
  className?: string;
}) {
  return (
    <div className={className}>
      <p aria-hidden="true" className={NUMERAL}>
        <DitherWord ground="ply-0" cell={3}>
          {index}
        </DitherWord>
      </p>
      <p className={`${KICKER} mt-6`}>{kicker}</p>
      <h2
        id={id}
        className={cn(
          "mt-3",
          size === "lg"
            ? `${DISPLAY_H2} max-w-[12ch]`
            : `${DISPLAY_H3} max-w-[16ch]`,
        )}
      >
        {title}
      </h2>
    </div>
  );
}

const TREE_FACTS: { mark: ReactNode; title: string; body: string }[] = [
  {
    mark: <Led state="talk" size={8} />,
    title: "A light when someone talks",
    body: "The same green light on their row in the tree and on their tile.",
  },
  {
    mark: <Icon name="micOff" size="sm" className="text-danger-ink" />,
    title: "Mic and headphones at a glance",
    body: "Muted and deafened show on every row, so nobody talks into the void.",
  },
  {
    mark: <Icon name="clock" size="sm" className="text-ink-2" />,
    title: "Who's in, and for how long",
    body: "Each voice channel carries its head count and call clock.",
  },
];

const ARTICLE = "scroll-mt-24 border-t border-line py-16 md:py-24";

/**
 * The product, one poster per feature, each opened by its dithered numeral:
 * voice and the tree (copy with three ruled facts beside a detail crop),
 * screen share (a full-width stage), chat (a reversed split) and a two-up
 * of Listen Together and the soundboard. Below `md` everything stacks and
 * the wide captures swap for phone captures.
 */
export function HomeProduct() {
  return (
    <section id="product" aria-label="Product" className="scroll-mt-16">
      <div className={CONTAINER}>
        {/* 01 Voice and the live tree */}
        <article
          id="feature-voice"
          aria-labelledby="feature-voice-title"
          className={cn(ARTICLE, "grid gap-10 md:grid-cols-12 md:gap-8")}
        >
          <div className="md:col-span-7">
            <FeatureHead
              index="01"
              kicker="Voice channels"
              id="feature-voice-title"
              title="Voice that stays open."
            />
            <p className={`${LEDE} mt-6 max-w-[40ch]`}>
              Leave a channel running. Friends see you&rsquo;re there and drop
              in, with no invite, no lobby and no waiting for a host. The tree
              shows who&rsquo;s in the call and who&rsquo;s talking.
            </p>
            <ul className="mt-10 grid gap-x-8 sm:grid-cols-3">
              {TREE_FACTS.map((fact, i) => (
                <li key={fact.title} className={RULE_COLUMN}>
                  <p className={`${KICKER} flex items-center gap-3`}>
                    <span className="text-ink-1">0{i + 1}</span>
                    <span
                      aria-hidden="true"
                      className="inline-flex h-4 items-center"
                    >
                      {fact.mark}
                    </span>
                  </p>
                  <h3 className={`${FACT_TITLE} mt-4`}>{fact.title}</h3>
                  <p className="mt-2 text-ui-sm text-pretty text-ink-2">
                    {fact.body}
                  </p>
                </li>
              ))}
            </ul>
          </div>
          <figure className="md:col-span-4 md:col-start-9 md:self-center">
            <WindowShot
              name="tree"
              alt="The channel tree in a busy call: the Lounge voice channel shows nine people and a 25 minute call clock, each person on their own branch with mute and deafen icons, and Linus lit green as talking"
              width={648}
              height={1176}
              sizes="(min-width: 768px) 360px, 300px"
              className="mx-auto w-full max-w-[300px] md:max-w-[360px]"
            />
          </figure>
        </article>

        {/* 02 Screen share */}
        <article
          id="feature-share"
          aria-labelledby="feature-share-title"
          className={ARTICLE}
        >
          <div className="grid gap-6 md:grid-cols-12 md:items-end md:gap-8">
            <FeatureHead
              index="02"
              kicker="Screen share"
              id="feature-share-title"
              title="Share the screen, keep the room."
              className="md:col-span-7"
            />
            <p className={`${BODY} max-w-[44ch] md:col-span-4 md:col-start-9`}>
              Put a window or the whole screen on the stage. Everyone watches in
              HD while the voice channel carries on around it, and the tree
              marks who is live.
            </p>
          </div>
          <figure className="mt-10 md:mt-12">
            <ResponsiveShot
              desktop={{
                name: "share",
                alt: "A Ralph Meet voice channel with Linus sharing his screen: a code editor fills the stage, a Live badge sits beside his stream, and the people in the call are on tiles below",
                width: 1440,
                height: 900,
              }}
              phone={{
                name: "share-stage",
                alt: "Linus sharing his screen in a Ralph Meet voice channel: a code editor fills the stage under a Live badge, with the people in the call on tiles below",
                width: 1116,
                height: 813,
              }}
              phoneFrame="window"
              sizes="(min-width: 1440px) 1360px, 92vw"
            />
          </figure>
        </article>

        {/* 03 Chat */}
        <article
          id="feature-chat"
          aria-labelledby="feature-chat-title"
          className={cn(
            ARTICLE,
            "grid gap-10 md:grid-cols-12 md:items-center md:gap-8",
          )}
        >
          <div className="md:order-2 md:col-span-4 md:col-start-9">
            <FeatureHead
              index="03"
              kicker="Text channels and DMs"
              id="feature-chat-title"
              title="Chat that keeps the thread."
              size="sm"
            />
            <p className={`${BODY} mt-6 max-w-[44ch]`}>
              Channels for topics and DMs for two, with replies, threads,
              reactions, pins, GIFs and files. The conversation is still there
              after you hang up.
            </p>
          </div>
          <figure className="md:order-1 md:col-span-8">
            <ResponsiveShot
              desktop={{
                name: "chat",
                alt: "A Ralph Meet text channel planning a trivia night: messages with reactions, a pinned reply, a shared file, a thread with two replies and the composer",
                width: 1440,
                height: 900,
              }}
              phone={{
                name: "phone-chat",
                alt: "Ralph Meet on a phone in the general channel, with messages, reactions, a shared file and the composer",
                width: 390,
                height: 844,
              }}
              sizes="(min-width: 1440px) 900px, 92vw"
            />
          </figure>
        </article>

        {/* 04 Listen Together, 05 the soundboard */}
        <div className="grid gap-x-8 border-t border-line md:grid-cols-12">
          <article
            id="feature-listen"
            aria-labelledby="feature-listen-title"
            className="flex scroll-mt-24 flex-col py-16 md:col-span-8 md:py-24"
          >
            <FeatureHead
              index="04"
              kicker="Listen Together"
              id="feature-listen-title"
              title="One queue, everyone in sync."
              size="sm"
            />
            <p className={`${BODY} mt-6 max-w-[44ch]`}>
              Search for a track or paste a YouTube or Spotify link. The room
              hears the same song at the same moment, from a queue anyone can
              add to.
            </p>
            <figure className="mt-10 md:mt-auto md:pt-10">
              <ResponsiveShot
                desktop={{
                  name: "listen",
                  alt: "Ralph Meet's Listen Together panel: search results on the left, Night Drive playing on the right with the shared queue below, each track tagged with who added it",
                  width: 1120,
                  height: 700,
                }}
                phone={{
                  name: "phone-listen",
                  alt: "Listen Together on a phone: search results for Lumen Arc with Play next and Queue buttons, and Night Drive playing below",
                  width: 390,
                  height: 844,
                }}
                sizes="(min-width: 1440px) 900px, 92vw"
              />
            </figure>
          </article>

          <article
            id="feature-soundboard"
            aria-labelledby="feature-soundboard-title"
            className="flex scroll-mt-24 flex-col border-t border-line py-16 md:col-span-4 md:border-t-0 md:py-24"
          >
            <FeatureHead
              index="05"
              kicker="Soundboard"
              id="feature-soundboard-title"
              title="A soundboard for the moment."
              size="sm"
            />
            <p className={`${BODY} mt-6 max-w-[44ch]`}>
              Tap a sound and the whole channel hears it. Upload your own clips,
              keep favourites close, and pick a sound for when you join or
              leave.
            </p>
            <figure className="mt-10 md:mt-auto md:pt-10">
              <div className="mx-auto w-full max-w-[300px] overflow-hidden rounded-[2px] border border-line-strong bg-ply-0 shadow-modal md:max-w-none">
                <Shot
                  name="soundboard"
                  alt="The Ralph Meet soundboard: favourites, the server's sounds such as Airhorn and Sad trombone, an Add sound tile, and send and playback volume sliders"
                  width={840}
                  height={1200}
                  sizes="(min-width: 768px) 420px, 300px"
                />
              </div>
            </figure>
          </article>
        </div>
      </div>
    </section>
  );
}
