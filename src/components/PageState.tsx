/**
 * Whole-page states for public routes, on the one public frame: a 48px
 * status tile, a title, one line of body copy, then 40px actions (one
 * primary, optionally a way home). The tile carries the tone; the title
 * stays ink-1.
 *
 * `RouteErrorPage` is the router's default error boundary and the share
 * route's: it never renders `error.message` (that can carry internals such
 * as D1 errors); the error goes to the console instead. In the desktop app
 * there is no marketing home, so its second action reloads the app.
 */

import {
  PublicActions,
  PublicBody,
  PublicFrame,
  PublicTitle,
  StatusTile,
  type StatusTone,
} from "@/components/auth/PublicFrame";
import { Button } from "@/components/ui/button";
import { type IconName } from "@/components/ui/icon";
import { clog } from "@/lib/console-logger";
import { isTauri } from "@/lib/platform";
import { useRouter, type ErrorComponentProps } from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

const log = clog("RouteError");

export function PageState({
  icon,
  title,
  body,
  tone = "neutral",
  children,
  className,
}: {
  icon: IconName;
  title: ReactNode;
  body?: ReactNode;
  /** The status tile's tone: `danger` for failures, `success` for done. */
  tone?: StatusTone;
  /** Actions: one primary, optionally followed by a way home. */
  children?: ReactNode;
  className?: string;
}) {
  return (
    <PublicFrame className={className}>
      <StatusTile icon={icon} tone={tone} />
      <PublicTitle>{title}</PublicTitle>
      {body ? <PublicBody>{body}</PublicBody> : null}
      {children ? <PublicActions>{children}</PublicActions> : null}
    </PublicFrame>
  );
}

/** A link home styled as a button; a full load, so a broken state resets. */
export function HomeLink({
  children = "Go home",
  variant = "ghost",
  href = "/",
}: {
  children?: ReactNode;
  variant?: "primary" | "default" | "secondary" | "ghost";
  href?: string;
}) {
  return (
    <Button asChild variant={variant} size="lg">
      <a href={href}>{children}</a>
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
        size="lg"
        onClick={() => {
          reset();
          void router.invalidate();
        }}
      >
        Try again
      </Button>
      {isTauri() ? (
        <Button
          variant="ghost"
          size="lg"
          onClick={() => window.location.reload()}
        >
          Reload app
        </Button>
      ) : (
        <HomeLink />
      )}
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
      <HomeLink variant="primary" />
    </PageState>
  );
}
