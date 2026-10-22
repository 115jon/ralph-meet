/**
 * Dev-only visual fixtures for the chat UI. Renders the real components with a
 * seeded store so the surfaces can be screenshotted without a signed-in
 * session. Not reachable in production builds (DEV guard + lazy import).
 *
 *   /ui-fixtures?surface=shell&theme=dark
 *
 * surfaces: shell | shell-empty | shell-dm | friends | voice | voice-live
 *           voice-landing
 *           settings | settings-<panel> (&row=<row-id>, &desktop=1)
 *           menus | splash | overlay | mobile
 */

import { createFileRoute, notFound } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

const Fixtures = import.meta.env.DEV
  ? lazy(() => import("@/components/dev/UiFixtures"))
  : null;

export const Route = createFileRoute("/ui-fixtures")({
  validateSearch: (search: Record<string, unknown>) => ({
    surface: typeof search.surface === "string" ? search.surface : "shell",
    theme: typeof search.theme === "string" ? search.theme : "dark",
  }),
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw notFound();
  },
  component: () => {
    if (!Fixtures) return null;
    return (
      <Suspense fallback={null}>
        <Fixtures />
      </Suspense>
    );
  },
});
