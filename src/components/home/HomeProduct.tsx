import { useEffect, useRef, useState } from "react";
import { Shot } from "./Shot";
import { CONTAINER } from "./ui";

interface Feature {
  id: string;
  label: string;
  title: string;
  body: string;
  shot: string;
  alt: string;
  /** Capture size; defaults to the 1440x900 desktop frame. */
  width?: number;
  height?: number;
}

const FEATURES: Feature[] = [
  {
    id: "voice",
    label: "Voice",
    title: "Voice that stays open.",
    body: "Leave a channel running. Friends see you're there and drop in, with no invite, no lobby and no waiting for a host.",
    shot: "voice",
    alt: "A Ralph Meet voice channel with four people on tiles and the call controls below",
  },
  {
    id: "share",
    label: "Screen share",
    title: "Share the screen, keep the room.",
    body: "Put a window or the whole screen on the stage. Everyone watches in HD while the voice channel carries on around it.",
    shot: "share",
    alt: "A Ralph Meet voice channel with a shared screen filling the stage and a live badge on the sharer",
  },
  {
    id: "chat",
    label: "Chat",
    title: "Chat that keeps the thread.",
    body: "Channels for topics, DMs for two, with GIFs, files, reactions and pins. The conversation carries on after you unmute.",
    shot: "chat",
    alt: "A Ralph Meet text channel with messages, a link preview, an attached file and the composer",
  },
  {
    id: "listen",
    label: "Listen Together",
    title: "One queue, everyone in sync.",
    body: "Paste a track or search for one. The room hears the same song at the same moment, with a queue anyone can add to.",
    shot: "listen",
    alt: "Ralph Meet's Listen Together panel: search results for Lumen Arc on the left, Night Drive playing on the right with the shared queue below",
    width: 1120,
    height: 700,
  },
  {
    id: "soundboard",
    label: "Soundboard",
    title: "A soundboard for the moment.",
    body: "Join and leave sounds, your own clips, and a volume per server. Loud when it should be, quiet when it shouldn't.",
    shot: "soundboard",
    alt: "Ralph Meet soundboard settings with playback volume and join and leave sounds",
  },
];

const ROW_HEIGHT = 44;

/**
 * The product, one moment per viewport. The rail on the left stays put
 * while the features scroll past on the right; a single marker slides down
 * the rail to the feature that is in the middle of the viewport. Below `lg`
 * the rail is a plain heading and the features stack.
 */
export function HomeProduct() {
  const [active, setActive] = useState(0);
  const articles = useRef<(HTMLElement | null)[]>([]);

  useEffect(() => {
    if (typeof IntersectionObserver !== "function") return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const index = Number((entry.target as HTMLElement).dataset.index);
          if (!Number.isNaN(index)) setActive(index);
        }
      },
      { rootMargin: "-45% 0px -45% 0px", threshold: 0 },
    );
    for (const node of articles.current) if (node) observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <section
      id="product"
      aria-labelledby="home-product-title"
      className="relative scroll-mt-16 border-t border-rm-border"
    >
      <div
        className={`${CONTAINER} grid gap-x-16 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]`}
      >
        <div className="pt-20 lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col lg:justify-between lg:py-24">
          <h2
            id="home-product-title"
            data-reveal
            className="rm-home-h2 max-w-[14ch] text-balance font-display text-rm-text"
          >
            Made for hanging out, not for meetings.
          </h2>

          <nav
            aria-label="Features"
            data-reveal
            data-reveal-delay="80"
            className="relative mt-12 hidden lg:block"
          >
            <div
              aria-hidden="true"
              className="absolute inset-y-0 left-0 w-px bg-rm-border"
            />
            <div
              aria-hidden="true"
              className="absolute left-0 top-0 h-11 w-0.5 bg-rm-text transition-transform duration-300 ease-(--rm-ease-out)"
              style={{ transform: `translateY(${active * ROW_HEIGHT}px)` }}
            />
            <ol>
              {FEATURES.map((feature, index) => (
                <li key={feature.id}>
                  <a
                    href={`#feature-${feature.id}`}
                    aria-current={active === index ? "true" : undefined}
                    className="flex h-11 items-center pl-6 text-ui-base text-rm-text-muted transition-colors duration-150 ease-(--rm-ease-out) aria-[current=true]:text-rm-text pointer-fine:hover:text-rm-text"
                  >
                    {feature.label}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        </div>

        <div className="flex flex-col gap-24 pb-24 pt-16 lg:gap-40 lg:py-24">
          {FEATURES.map((feature, index) => (
            <article
              key={feature.id}
              id={`feature-${feature.id}`}
              data-index={index}
              ref={(node) => {
                articles.current[index] = node;
              }}
              className="scroll-mt-24"
            >
              <div data-reveal className="max-w-[46ch]">
                <h3 className="rm-home-h3 text-balance font-display text-rm-text">
                  {feature.title}
                </h3>
                <p className="mt-4 text-pretty text-ui-md text-rm-text-secondary">
                  {feature.body}
                </p>
              </div>
              <figure
                data-reveal
                data-reveal-delay="120"
                className="mt-8 overflow-hidden rounded-xl border border-rm-border bg-rm-bg-surface"
              >
                <Shot
                  name={feature.shot}
                  alt={feature.alt}
                  width={feature.width ?? 1440}
                  height={feature.height ?? 900}
                  sizes="(min-width: 1024px) 58vw, 100vw"
                />
              </figure>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
