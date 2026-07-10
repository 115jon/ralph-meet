import { createFileRoute } from "@tanstack/react-router";

import { PUBLIC_POLICY } from "@/lib/public-policy";

export const Route = createFileRoute("/privacy")({
  component: PrivacyPage,
  head: () => ({
    meta: [
      { title: "Privacy Policy - Ralph Meet" },
      {
        name: "description",
        content: "How Ralph Meet processes information and connects to services.",
      },
    ],
  }),
});

function PrivacyPage() {
  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl px-6 py-16 text-rm-text sm:px-10">
      <a href="/" className="text-sm font-semibold text-rm-accent hover:underline">
        Ralph Meet
      </a>
      <h1 className="mt-8 text-3xl font-bold">Privacy Policy</h1>
      <p className="mt-4 text-rm-text-secondary">Effective July 10, 2026</p>

      <section className="mt-10 space-y-4 leading-7 text-rm-text-secondary">
        <p>
          Ralph Meet processes account, communication, and device information needed to provide
          chat, voice, video, screen sharing, and desktop application features. Questions and
          privacy requests can be sent to {PUBLIC_POLICY.contactEmail}.
        </p>
        <p>
          The service uses <code>meet.115jon.site</code> for application services and
          <code> auth.115jon.site</code> for the project-maintained Kova authentication service.
          Desktop releases and update metadata are distributed through GitHub Releases.
        </p>
        <p>
          The desktop application may restore a saved session, check for updates, and connect to
          Ralph Meet chat services after sign-in. Update checks and other automatic connections are
          being made configurable before the next SignPath Foundation candidate release.
        </p>
        <p>
          Voice and video use WebRTC transport security, including DTLS-SRTP. Ralph Meet does not
          claim end-to-end encryption unless that design is independently documented and verified.
        </p>
      </section>

      <p className="mt-10 text-sm text-rm-text-secondary">
        The complete repository policy is available in{" "}
        <a
          className="font-semibold text-rm-accent hover:underline"
          href="https://github.com/115jon/ralph-meet/blob/main/PRIVACY.md"
        >
          PRIVACY.md
        </a>
        .
      </p>
    </main>
  );
}
