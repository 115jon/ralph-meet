import { ThemeAwareSplashLogo } from "@/components/ThemeAwareSplashLogo";
import { REPO_URL } from "./releases";
import { CONTAINER, SILK_LINK } from "./ui";

export interface HomeFooterProps {
  isSignedIn: boolean;
  onStartRoom: () => void;
}

const LINK = `${SILK_LINK} md:min-h-8`;

function External({ href, children }: { href: string; children: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={LINK}>
      {children}
    </a>
  );
}

export function HomeFooter({ isSignedIn, onStartRoom }: HomeFooterProps) {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t-2 border-ink-1">
      <div
        className={`${CONTAINER} grid gap-12 py-14 md:grid-cols-[minmax(0,6fr)_minmax(0,3fr)_minmax(0,3fr)] md:gap-8 lg:py-16`}
      >
        <div>
          <a
            href="#home-hero"
            className="inline-flex min-h-11 items-center gap-3 rounded-[2px] font-display text-[17px] font-extrabold tracking-[-0.02em] text-ink-1"
          >
            <ThemeAwareSplashLogo className="size-7 select-none" />
            Ralph Meet
          </a>
          <p className="mt-4 max-w-[34ch] text-pretty text-ui-sm text-ink-2">
            Open source voice and chat, running on Cloudflare&rsquo;s edge.
          </p>
        </div>

        <nav aria-label="Product">
          <h2 className="silkscreen text-ink-1">Product</h2>
          <ul className="mt-2 flex flex-col">
            <li>
              <button type="button" onClick={onStartRoom} className={LINK}>
                Start a room
              </button>
            </li>
            <li>
              <a href="#join" className={LINK}>
                Join a room
              </a>
            </li>
            <li>
              <a href="#download" className={LINK}>
                Download
              </a>
            </li>
            <li>
              <a href={isSignedIn ? "/chat" : "/sign-in"} className={LINK}>
                {isSignedIn ? "Open the app" : "Sign in"}
              </a>
            </li>
          </ul>
        </nav>

        <nav aria-label="Project">
          <h2 className="silkscreen text-ink-1">Project</h2>
          <ul className="mt-2 flex flex-col">
            <li>
              <External href={REPO_URL}>GitHub</External>
            </li>
            <li>
              <External href={`${REPO_URL}/releases`}>Releases</External>
            </li>
            <li>
              <External href={`${REPO_URL}/blob/main/PRIVACY.md`}>
                Privacy
              </External>
            </li>
            <li>
              <External href={`${REPO_URL}/blob/main/SECURITY.md`}>
                Security
              </External>
            </li>
          </ul>
        </nav>
      </div>
      <div className={`${CONTAINER} border-t border-line py-6`}>
        <p className="silkscreen text-ink-3">&copy; {year} Ralph Meet</p>
      </div>
    </footer>
  );
}
