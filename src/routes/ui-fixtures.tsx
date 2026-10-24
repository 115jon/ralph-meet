/**
 * Dev-only visual fixtures for the chat UI. Renders the real components with a
 * seeded store so the surfaces can be screenshotted without a signed-in
 * session. Not reachable in production builds (DEV guard + lazy import).
 *
 *   /ui-fixtures?surface=shell&theme=dark
 *
 * surfaces: shell | shell-empty | shell-dm | friends | voice | voice-live
 *           voice-share | voice-share-grid | voice-listen | voice-landing
 *           settings | settings-<panel> (&row=<row-id>, &desktop=1)
 *           menus | splash | overlay (reconnecting) | overlay-connecting
 *           mobile | mobile-sidebar
 *           mobile-home (&tab=servers|messages|notifications|you)
 *           mobile-profile | mobile-profile-me | drawer | action-sheet
 *           search | search-idle | search-results | search-filtered
 *           search-empty | search-loading | search-error | search-dm
 *           command-menu (&q=)
 *           shop | catalog-decorations | catalog-effects
 *           catalog-nameplates | catalog-frames
 *           shell-chat (shell without the member list)
 *           friends (&tab=online|all|pending|blocked) | dm-empty | members
 *           shell-readonly (composer without send permission)
 *           message-rows (unread banner + rows; hover a row for the bar)
 *           ov-* overlays (design-audit units 7-9), each mounted open:
 *             ov-pin | ov-unpin | ov-reactions | ov-upload-sound
 *             ov-create-server | ov-create-channel | ov-create-category
 *             ov-share | ov-start-call | ov-voice-switch
 *             ov-voice-text-status | ov-voice-media-status
 *             ov-audio-interaction | ov-external-link | ov-delete-message
 *             ov-remove-embeds | ov-sound-delete | ov-desktop-restart
 *             ov-pins-empty | ov-pins-loading | ov-stream-menu
 *             ov-stream-menu-self | ov-mention | ov-image-viewer
 *             ov-voice-dashboard | ov-voice-details | ov-stream-settings
 *             ov-noise-menu | ov-profile | ov-account | ov-audio-device
 *           fx-* feedback + media (feedback-fixtures.tsx): fx-toast
 *             fx-toast-copied | fx-confirm-{channel,category,kick,ban,
 *             attachment,error} | fx-buttons | fx-image-grid | fx-video
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
