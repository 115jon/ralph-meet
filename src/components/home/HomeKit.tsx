import { Icon, type IconName } from "@/components/ui/icon";
import { CONTAINER, DISPLAY_H2, FACT_TITLE, KICKER, RULE_COLUMN } from "./ui";

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
    body: "Spaces for groups with their own channels, direct messages for two.",
  },
  {
    icon: "globe",
    title: "Cloudflare's edge",
    body: "Media routed through the nearest edge location, so the path stays short.",
  },
];

/**
 * The rest of the kit as ruled columns: four up on a 2px ink rule each, a
 * silkscreen index and glyph over a Bricolage title. No cards.
 */
export function HomeKit() {
  return (
    <section
      aria-labelledby="home-kit-title"
      className="border-t border-line py-16 md:py-24"
    >
      <div className={CONTAINER}>
        <p className={KICKER}>Also in the room</p>
        <h2 id="home-kit-title" className={`${DISPLAY_H2} mt-3 max-w-[16ch]`}>
          And the rest of the kit.
        </h2>
        <ul className="mt-10 grid gap-x-8 sm:grid-cols-2 md:mt-14 lg:grid-cols-4">
          {ITEMS.map((item, i) => (
            <li key={item.title} className={RULE_COLUMN}>
              <p className={`${KICKER} flex items-center gap-3`}>
                <span className="text-ink-1">0{i + 1}</span>
                <Icon
                  name={item.icon}
                  size="sm"
                  aria-hidden="true"
                  className="text-ink-2"
                />
              </p>
              <h3 className={`${FACT_TITLE} mt-4`}>{item.title}</h3>
              <p className="mt-2 max-w-[36ch] text-ui-sm text-pretty text-ink-2">
                {item.body}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
