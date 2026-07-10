# Code Signing Policy

> Free code signing provided by [SignPath.io](https://signpath.io), certificate
> by [SignPath Foundation](https://signpath.org).

Ralph Meet is preparing an application for the SignPath Foundation open-source
code-signing program. This document describes the intended controls. No artifact
is represented as SignPath-signed until a valid Authenticode signature is
published and can be independently verified.

## Signing roles

| Role | Responsibility | Member |
| --- | --- | --- |
| Committer | Maintains the source code and release configuration | [115jon](https://github.com/115jon) |
| Reviewer | Reviews changes from contributors who are not committers | [115jon](https://github.com/115jon) |
| Approver | Approves each release-signing request | [115jon](https://github.com/115jon) |

The three roles are currently held by the same maintainer. Contributions from
other people still require maintainer review before merge. Automated tools may
assist review but do not hold a signing role.

## Signing scope

The initial requested scope is limited to `RalphMeet.exe` and
`RalphMeetSetup.exe`, built from this repository by GitHub-hosted release CI.
The installer may include separately classified upstream components, including
CEF runtime files and the OBS-derived optional capture component, without
representing those included components as directly signed.

Any expansion to sign modified upstream artifacts requires a public source fork,
reviewed release provenance, and explicit SignPath Foundation approval.

## Release controls

Each release follows this sequence:

1. GitHub-hosted CI builds the release from a protected release tag.
2. CI creates a classified payload manifest, checksums, and SBOM before signing.
3. Ralph Meet submits only eligible first-party artifacts to SignPath.io.
4. The named Approver manually reviews and approves the signing request.
5. CI verifies the returned Authenticode signatures and trusted timestamps before
   publishing the release and updater metadata.

Release signing requests originate only from protected release origins and
GitHub-hosted workflows. Signed artifacts must have enforced Ralph Meet product
metadata and a version matching the release. Release artifacts, checksums, SBOMs,
provenance records, and signature-verification results are retained with each
release.

## Privacy policy

Ralph Meet's privacy policy is available at [PRIVACY.md](PRIVACY.md) and will be
published at <https://meet.115jon.site/privacy>. The installer must present this
policy and required choices before a first installation that enables automatic
data transfers.

## Verification and incident response

Release pages will identify the signed files, their checksums, and the files that
are intentionally included unsigned as upstream components. Users should verify
the Authenticode signature and checksum before installation.

Report suspected malicious artifacts, signing-policy violations, or certificate
concerns to <115jon@proton.me> and through the project's security-reporting
channel. Ralph Meet will investigate the report, preserve relevant release
evidence, and cooperate with SignPath Foundation on revocation or remediation.
