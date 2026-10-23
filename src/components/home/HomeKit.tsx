import { Icon, type IconName } from "@/components/ui/icon";
import { CONTAINER } from "./ui";

interface Item {
  icon: IconName;
  title: string;
  body: string;
}

const ITEMS: Item[] = [
  {
    icon: "camera",
    title: "Video",
    body: "Camera on when you want it, in a grid that keeps faces big.",
  },
  {
    icon: "activities",
    title: "Activities",
    body: "Games and activities that run inside the voice channel.",
  },
  {
    icon: "members",
    title: "Servers and DMs",
    body: "Spaces for groups, direct messages for two.",
  },
  {
    icon: "globe",
    title: "Cloudflare's edge",
    body: "Media routed through the nearest edge location, so the path stays short.",
  },
];

/**
 * The rest of the kit as a ledger: hairline rows, no cards. A different
 * layout family from the product stage above and the platform split below.
 */
export function HomeKit() {
  return (
    <section
      aria-labelledby="home-kit-title"
      className="border-t border-rm-border py-24 lg:py-32"
    >
      <div className={CONTAINER}>
        <h2
          id="home-kit-title"
          data-reveal
          className="rm-home-h2 max-w-[16ch] text-balance font-display text-rm-text"
        >
          And the rest of the kit.
        </h2>
        <ul className="mt-12 grid gap-x-12 md:grid-cols-2 lg:mt-16 lg:grid-cols-4">
          {ITEMS.map((item, index) => (
            <li
              key={item.title}
              data-reveal
              data-reveal-delay={String((index % 4) * 60)}
              className="flex gap-4 border-t border-rm-border py-6"
            >
              <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center text-rm-text">
                <Icon name={item.icon} size="lg" />
              </span>
              <div>
                <h3 className="text-ui-md font-semibold text-rm-text">
                  {item.title}
                </h3>
                <p className="mt-1 max-w-[36ch] text-pretty text-ui-sm text-rm-text-secondary">
                  {item.body}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
