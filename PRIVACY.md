# Ralph Meet Privacy Policy

Effective date: July 10, 2026

Ralph Meet is operated by 115jon. Questions about this policy, privacy requests,
or data deletion requests can be sent to <115jon@proton.me>.

## Information Ralph Meet processes

Ralph Meet processes account identifiers, optional account profile information,
room/server/channel information, chat messages, attachments, relationship and
read-state data, notification preferences, and audit records needed to operate
the service. When a user joins a voice or video session, the service processes
the room/channel identifiers, connection credentials, and the media the user
chooses to send.

The desktop application may store account-session information and application
settings on the user's device. Browser and CEF runtime data, such as cached web
resources and local storage, may also be stored locally.

## Where information is sent

Ralph Meet uses these services:

- `meet.115jon.site` for the Ralph Meet application API, chat gateway, and
  service functions.
- `auth.115jon.site` for the project-maintained Kova authentication service.
- Cloudflare services for application delivery and infrastructure.
- GitHub Releases for published desktop releases and desktop update metadata.
- WebRTC/SFU services used by Ralph Meet for voice, video, and screen sharing.

The web and desktop applications can also connect to locations selected by the
user or supplied in user content, such as a shared link, embed, attachment, or
room invitation.

## Automatic desktop connections

The current desktop client may check GitHub Releases for application updates,
restore a previously saved session with Ralph Meet/Kova services, and connect to
the chat gateway after a signed-in chat view opens. These behaviors are being
made explicitly configurable during installation and in desktop settings before
the next SignPath Foundation candidate release. Automatic update downloads and
installation must require a user action.

The desktop application does not include a dedicated third-party analytics SDK.
This statement does not limit infrastructure logging needed to secure, operate,
or diagnose the service.

## How Ralph Meet uses information

Ralph Meet uses information to authenticate users, provide chat and real-time
communication, deliver notifications, store user-selected content, prevent
abuse, secure the service, and investigate service failures. Ralph Meet does not
sell personal information.

## Retention and deletion

Account and profile data is kept while an account is active. Following a confirmed
account deletion, Ralph Meet deletes or anonymizes live account data within 30
days, except for limited records needed for security, fraud prevention, legal
compliance, or software-distribution obligations.

Messages, DMs, and server content remain until deleted by their sender, a
moderator, or a server/channel deletion action. When an account is deleted,
shared conversation content is retained for conversation integrity and the
deleted account is anonymized within 30 days. Public message-share links default
to 30 days and are removed earlier when revoked or when their source message is
deleted.

Attachments and other stored files remain while their related content needs them.
Unattached uploads are removed within 24 hours. Files tied to deleted content are
removed from live object storage within 7 days. Server audit logs are retained
for 180 days and security/abuse-prevention records for 90 days, unless an active
investigation, legal hold, or security need requires longer retention.

Ralph Meet does not intentionally record or store live voice, video, or
screen-share media during normal operation. Realtime credentials and recovery
metadata are retained only for the short periods needed to run or recover a
session. Operational logs are retained for up to 7 days and must not intentionally
contain message bodies, attachment contents, authentication tokens, or full
SDP/ICE payloads. Disaster-recovery backups, if enabled, are retained for up to
30 days; live deletion happens first and backup copies age out on that cycle.

Before deletion, users may request an export of their account data. Users may
request access, correction, deletion, or export by contacting <115jon@proton.me>.
GPL source-offer request and fulfillment records are retained for at least three
years from the relevant binary distribution date.

## Security

Ralph Meet uses HTTPS and transport encryption for supported network
connections. Voice/video transport uses WebRTC security mechanisms, including
DTLS-SRTP. Ralph Meet does not claim end-to-end encryption for service features
unless that design is independently documented and verified.

## Changes

This policy may change as the service changes. Material changes will be published
in this document with a revised effective date.
