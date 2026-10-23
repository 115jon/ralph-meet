import { ThemeAwareSplashLogo } from "@/components/ThemeAwareSplashLogo";
import { UserButton, useAuth } from "@kova/react";
import { useEffect, useState } from "react";
import { CONTAINER, CTA_OUTLINE, CTA_PRIMARY, TEXT_LINK } from "./ui";

export const SCROLL_SENTINEL_ID = "home-scroll-sentinel";

const NAV = [
  { href: "#product", label: "Product" },
  { href: "#download", label: "Download" },
  { href: "#join", label: "Join a room" },
] as const;

/**
 * Fixed header laid out as a three-column grid rather than a bar: brand,
 * in-page links, account. Transparent over the hero; once the sentinel
 * under it scrolls away it takes the page ground and a hairline.
 */
export function HomeHeader() {
  const { isSignedIn } = useAuth();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const sentinel = document.getElementById(SCROLL_SENTINEL_ID);
    if (!sentinel || typeof IntersectionObserver !== "function") return;
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[0];
      setScrolled(entry ? !entry.isIntersecting : false);
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  return (
    <header
      data-scrolled={scrolled ? "true" : "false"}
      className="fixed inset-x-0 top-0 z-20 border-b border-transparent transition-colors duration-200 ease-(--rm-ease-out) data-[scrolled=true]:border-rm-border data-[scrolled=true]:bg-rm-bg-primary"
    >
      <div
        className={`${CONTAINER} grid h-16 grid-cols-[1fr_auto] items-center gap-4 md:grid-cols-[1fr_auto_1fr]`}
      >
        <a
          href="#home-hero"
          className="flex min-h-11 w-fit items-center gap-3 rounded-sm text-ui-base font-semibold tracking-[-0.01em] text-rm-text"
        >
          <ThemeAwareSplashLogo className="size-7 select-none" />
          Ralph Meet
        </a>

        <nav aria-label="Page" className="hidden items-center gap-8 md:flex">
          {NAV.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className={`${TEXT_LINK} flex min-h-11 items-center text-ui-sm font-medium`}
            >
              {item.label}
            </a>
          ))}
        </nav>

        <nav
          aria-label="Account"
          className="flex items-center justify-end gap-3"
        >
          {isSignedIn ? (
            <>
              <a href="/chat" className={CTA_PRIMARY + " h-9 px-4 text-ui-sm"}>
                Open the app
              </a>
              <div className="flex size-9 items-center justify-center rounded-full bg-rm-tint-1">
                <UserButton
                  afterSignOutUrl="/"
                  size={32}
                  appearance={{ variables: { colorPrimary: "#5865f2" } }} // ds-allow:raw-color Kova widget theme, not a page surface
                />
              </div>
            </>
          ) : (
            <a href="/sign-in" className={CTA_OUTLINE}>
              Sign in
            </a>
          )}
        </nav>
      </div>
    </header>
  );
}
