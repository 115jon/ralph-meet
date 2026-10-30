import { Icon, type IconName } from "@/components/ui/icon";
import type { DesktopRelease } from "./releases";
import { PhoneShot } from "./Shot";
import { KeyLink } from "./Keys";
import { CONTAINER, DISPLAY_H2, FACT_TITLE, KICKER, LEDE } from "./ui";

export interface HomePlatformsProps {
  release: DesktopRelease;
  isSignedIn: boolean;
}

const PLACES: { icon: IconName; title: string; body: string }[] = [
  {
    icon: "monitor",
    title: "Windows",
    body: "A desktop app with a tray icon and keybinds.",
  },
  {
    icon: "globe",
    title: "Browser",
    body: "Nothing to install. Open a link and you're in.",
  },
  {
    icon: "mobile",
    title: "Phone",
    body: "The same rooms in your phone's browser.",
  },
];

/**
 * Platform split: the places it runs and the download actions beside the
 * real responsive app at 390 wide in a phone frame.
 */
export function HomePlatforms({ release, isSignedIn }: HomePlatformsProps) {
  return (
    <section
      id="download"
      aria-labelledby="home-platforms-title"
      className="scroll-mt-16 border-t border-line"
    >
      <div
        className={`${CONTAINER} grid items-center gap-14 py-16 md:py-24 lg:grid-cols-12 lg:gap-8`}
      >
        <div className="lg:col-span-7">
          <p className={KICKER}>Download</p>
          <h2
            id="home-platforms-title"
            className={`${DISPLAY_H2} mt-3 max-w-[14ch]`}
          >
            On your desk. In your pocket.
          </h2>
          <p className={`${LEDE} mt-6 max-w-[42ch]`}>
            The same rooms and the same account everywhere, so you can start on
            the desktop and carry on from the sofa.
          </p>
          <ul className="mt-10 grid gap-x-8 sm:grid-cols-3">
            {PLACES.map((place) => (
              <li
                key={place.title}
                className="border-t-2 border-ink-1 pt-4 pb-6"
              >
                <Icon
                  name={place.icon}
                  size="md"
                  aria-hidden="true"
                  className="text-ink-2"
                />
                <h3 className={`${FACT_TITLE} mt-3`}>{place.title}</h3>
                <p className="mt-1 text-ui-sm text-pretty text-ink-2">
                  {place.body}
                </p>
              </li>
            ))}
          </ul>
          <div className="mt-6 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
            <KeyLink variant="primary" href={release.downloadUrl}>
              <Icon name="download" size="sm" />
              Download for Windows
            </KeyLink>
            <KeyLink href={isSignedIn ? "/chat" : "/sign-in"} paired>
              Open in the browser
            </KeyLink>
          </div>
          <p className="silkscreen mt-4 text-ink-3 [overflow-wrap:anywhere]">
            {release.name} · {release.fileName} · Windows 10 and later
          </p>
        </div>

        <figure className="justify-self-center lg:col-span-4 lg:col-start-9">
          <PhoneShot
            name="phone-home"
            alt="Ralph Meet on a phone: the Ralph HQ server with its text channels and the Lounge voice channel showing who is in it, above the bottom tab bar"
            width={390}
            height={844}
            sizes="300px"
            className="w-[260px] md:w-[300px]"
          />
        </figure>
      </div>
    </section>
  );
}
