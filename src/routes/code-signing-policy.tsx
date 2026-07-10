import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/code-signing-policy")({
  component: CodeSigningPolicyPage,
  head: () => ({
    meta: [
      { title: "Code Signing Policy - Ralph Meet" },
      {
        name: "description",
        content: "Ralph Meet's public code-signing controls and release policy.",
      },
    ],
  }),
});

function CodeSigningPolicyPage() {
  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl px-6 py-16 text-rm-text sm:px-10">
      <a href="/" className="text-sm font-semibold text-rm-accent hover:underline">
        Ralph Meet
      </a>
      <h1 className="mt-8 text-3xl font-bold">Code Signing Policy</h1>
      <section className="mt-10 space-y-4 leading-7 text-rm-text-secondary">
        <p>
          Free code signing provided by{" "}
          <a className="font-semibold text-rm-accent hover:underline" href="https://signpath.io">
            SignPath.io
          </a>
          , certificate by{" "}
          <a className="font-semibold text-rm-accent hover:underline" href="https://signpath.org">
            SignPath Foundation
          </a>
          .
        </p>
        <p>
          The initial signing scope is limited to Ralph Meet-owned application and installer
          binaries built from protected release tags in GitHub-hosted CI. Each signing request
          requires manual approval by 115jon.
        </p>
        <p>
          CEF runtime files and the optional OBS-derived capture component are separately
          classified in release evidence. They are not represented as directly signed unless
          SignPath Foundation approves their provenance and signing scope.
        </p>
      </section>

      <p className="mt-10 text-sm text-rm-text-secondary">
        The complete repository policy is available in{" "}
        <a
          className="font-semibold text-rm-accent hover:underline"
          href="https://github.com/115jon/ralph-meet/blob/main/CODE_SIGNING_POLICY.md"
        >
          CODE_SIGNING_POLICY.md
        </a>
        .
      </p>
    </main>
  );
}
