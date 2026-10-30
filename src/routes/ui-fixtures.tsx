/**
 * Dev-only visual fixtures for the chat UI. Renders the real components with a
 * seeded store so the surfaces can be screenshotted without a signed-in
 * session. Not reachable in production builds: the route throws notFound()
 * and the fixture module is only imported when `import.meta.env.DEV`.
 *
 *   /ui-fixtures?surface=shell&theme=dark
 *
 * Search params: `surface` (default "shell"), `theme` (default "dark", passed
 * to next-themes, so any theme id the app knows works), and `copy=landing`
 * (product-neutral content for the landing captures; renders client-only).
 * Individual surfaces read further params straight from the URL (`row`, `tab`,
 * `w`, `q`, `desktop`, `kit`, `frame`, `state`, `corner`...); see the fixture
 * that owns the surface.
 *
 * The authoritative surface list is the dispatch in
 * `components/dev/UiFixtures.tsx` (anything it does not recognise falls back
 * to the chat shell). Families, by name:
 *   shell*, dm-*, dm-call-*, members, friends, account-row, message-rows
 *   voice*, room*, incoming-call, voice-debug*, connection-states
 *   settings, settings-<panel>, sp-* (settings and profile editors)
 *   search*, command-menu, menus, splash, overlay*, no-channel, drawer*
 *   mobile*, action-sheet, shop, catalog-*, updater*
 *   ov-* overlays (each mounted open), fx-* feedback + media, st-* screen
 *   share, fl-* floating players, pk-* pickers, embed-* link embeds,
 *   act-* activities, pub-* public pages
 *   foundation, component-kit, dither-mockups, type-mockups (design specimens)
 */

import { createFileRoute, notFound } from "@tanstack/react-router";
import { lazy, Suspense, useSyncExternalStore } from "react";

const Fixtures = import.meta.env.DEV
  ? lazy(() => import("@/components/dev/UiFixtures"))
  : null;

export const Route = createFileRoute("/ui-fixtures")({
  validateSearch: (search: Record<string, unknown>) => ({
    surface: typeof search.surface === "string" ? search.surface : "shell",
    theme: typeof search.theme === "string" ? search.theme : "dark",
    // `landing`: product-neutral content for the landing page captures.
    copy: search.copy === "landing" ? ("landing" as const) : undefined,
  }),
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw notFound();
  },
  component: FixturesRoute,
});

const subscribeNever = () => () => {};

/**
 * The landing copy is chosen from `location.search` when the fixture module
 * loads, which the server cannot see, so that variant renders client-only
 * (nothing on the server, nothing on the hydrating pass) to keep hydration
 * clean.
 */
function FixturesRoute() {
  const { copy } = Route.useSearch();
  const mounted = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
  if (!Fixtures) return null;
  if (copy === "landing" && !mounted) return null;
  return (
    <Suspense fallback={null}>
      <Fixtures />
    </Suspense>
  );
}
