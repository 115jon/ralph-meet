/**
 * Whole-page states for public routes (design-system 14.1 / 14.3): an icon
 * illustration, a title, one line of body copy and at most a primary action
 * plus a way home. Never a card, border, shadow or blur around it.
 *
 * `RouteErrorPage` is the router's default error boundary and the share
 * route's: it never renders `error.message` (that can carry internals such
 * as D1 errors); the error goes to the console instead.
 */

import { Button } from "@/components/ui/button";
import { Icon, type IconName } from "@/components/ui/icon";
import { clog } from "@/lib/console-logger";
import { useRouter, type ErrorComponentProps } from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

const log = clog("RouteError");

export function PageState({
  icon,
  title,
  body,
  tone = "default",
  children,
  className = "min-h-dvh",
}: {
  icon: IconName;
  title: ReactNode;
  body?: ReactNode;
  /** `danger` is a whole-view error: the title takes the danger ink. */
  tone?: "default" | "danger";
  /** Actions: one primary, optionally followed by a way home. */
  children?: ReactNode;
  /** Height of the frame; defaults to the full viewport. */
  className?: string;
}) {
  return (
    <main
      className={`flex w-full items-center justify-center bg-rm-bg-primary px-6 py-12 text-rm-text ${className}`}
    >
      <div className="flex max-w-[36ch] flex-col items-center gap-3 text-center">
        <Icon
          name={icon}
          size="3xl"
          className="text-rm-text-muted max-md:size-8"
        />
        <h1
          className={`text-balance text-ui-lg font-semibold ${
            tone === "danger" ? "text-rm-danger-ink" : "text-rm-text"
          }`}
        >
          {title}
        </h1>
        {body ? (
          <p className="text-pretty text-ui-sm text-rm-text-secondary">
            {body}
          </p>
        ) : null}
        {children ? (
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            {children}
          </div>
        ) : null}
      </div>
    </main>
  );
}

/** A link home styled as a button; a full load, so a broken state resets. */
export function HomeLink({
  children = "Go home",
  variant = "ghost",
}: {
  children?: ReactNode;
  variant?: "default" | "secondary" | "ghost";
}) {
  return (
    <Button asChild variant={variant}>
      <a href="/">{children}</a>
    </Button>
  );
}

export function RouteErrorPage({
  error,
  reset,
  title = "This page didn't load",
  body = "We couldn't load this page. Try again, or go back home.",
}: Pick<ErrorComponentProps, "error" | "reset"> & {
  title?: string;
  body?: string;
}) {
  const router = useRouter();

  useEffect(() => {
    log.error("Route error", error);
  }, [error]);

  return (
    <PageState icon="alert" tone="danger" title={title} body={body}>
      <Button
        onClick={() => {
          reset();
          void router.invalidate();
        }}
      >
        Try again
      </Button>
      <HomeLink />
    </PageState>
  );
}

export function NotFoundPage() {
  return (
    <PageState
      icon="linkBroken"
      title="Page not found"
      body="The link may be broken, or the page may have moved."
    >
      <HomeLink variant="default" />
    </PageState>
  );
}
