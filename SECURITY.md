# Security Policy

## Supported releases

The latest public release is the supported release. Users should upgrade before
reporting an issue against an older version whenever possible.

## Reporting a vulnerability

Report security vulnerabilities privately to <115jon@proton.me>. Include a
description, reproduction steps, affected version, and any suggested mitigation.

Do not publish proof-of-concept exploit details until the issue has been
acknowledged and a remediation timeline has been agreed.

## Scope

Reports may cover the web application, desktop client, authentication and
authorization, realtime admission, installer behavior, update handling, native
capture code, release workflows, or bundled runtime provenance.

Third-party dependencies and Cloudflare infrastructure should also be reported
to their respective maintainers when the issue is not caused by Ralph Meet's
integration.

## Release security

Release-sensitive changes include authentication, authorization, installer
behavior, release workflows, code-signing configuration, CEF runtime provenance,
and the game-capture component. These changes require maintainer review and
must preserve the artifact inventory and source/license records.

## Disclosure

We will acknowledge a report, investigate it, and coordinate a fix or mitigation
before public disclosure whenever doing so protects users. Please do not use
public GitHub issues for unpatched security vulnerabilities.
