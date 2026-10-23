import { ThemeAwareSplashLogo } from "@/components/ThemeAwareSplashLogo";
import { REPO_URL } from "./releases";
import { CONTAINER, TEXT_LINK } from "./ui";

export interface HomeFooterProps {
  isSignedIn: boolean;
  onStartRoom: () => void;
}

const LINK = `${TEXT_LINK} inline-flex min-h-11 items-center text-ui-sm md:min-h-8`;

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
    <footer className="border-t border-rm-border">
      <div
        className={`${CONTAINER} grid gap-12 py-16 md:grid-cols-[minmax(0,6fr)_minmax(0,3fr)_minmax(0,3fr)] md:gap-8 lg:py-20`}
      >
        <div>
          <a
            href="#home-hero"
            className="inline-flex min-h-11 items-center gap-3 rounded-sm text-ui-base font-semibold text-rm-text"
          >
            <ThemeAwareSplashLogo className="size-7 select-none" />
            Ralph Meet
          </a>
          <p className="mt-4 max-w-[34ch] text-pretty text-ui-sm text-rm-text-secondary">
            Open source voice and chat, running on Cloudflare&rsquo;s edge.
          </p>
        </div>

        <nav aria-label="Product">
          <h2 className="text-ui-sm font-semibold text-rm-text">Product</h2>
          <ul className="mt-3 flex flex-col">
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
          <h2 className="text-ui-sm font-semibold text-rm-text">Project</h2>
          <ul className="mt-3 flex flex-col">
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
      <div className={`${CONTAINER} border-t border-rm-border py-6`}>
        <p className="text-ui-xs text-rm-text-muted">
          &copy; {year} Ralph Meet
        </p>
      </div>
    </footer>
  );
}
