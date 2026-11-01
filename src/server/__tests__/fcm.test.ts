// FCM sender: the service-account JWT (signed with a throwaway key generated
// here, never a real one), the access-token cache and token-error detection.

import { createVerify, generateKeyPairSync } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  buildServiceAccountJwt,
  createFcmSender,
  isStaleTokenError,
  parseServiceAccount,
  type FcmMessage,
  type ServiceAccount,
} from "@/server/fcm";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

const ACCOUNT: ServiceAccount = {
  project_id: "test-project",
  client_email: "push@test-project.iam.gserviceaccount.com",
  private_key: privateKey,
};

const MESSAGE: FcmMessage = {
  notification: { title: "Ada", body: "hi" },
  data: { type: "dm", channelId: "c1", messageId: "m1" },
  android: {
    priority: "HIGH",
    notification: { channel_id: "messages", tag: "channel:c1" },
  },
};

const OAUTH_URL = "https://oauth2.googleapis.com/token";

function decodeSegment(segment: string): Record<string, string | number> {
  return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
}

describe("parseServiceAccount", () => {
  it("reads the fields it needs and refuses anything else", () => {
    expect(
      parseServiceAccount(JSON.stringify({ ...ACCOUNT, type: "x" })),
    ).toEqual(ACCOUNT);
    expect(parseServiceAccount("{")).toBeNull();
    expect(parseServiceAccount(JSON.stringify({ project_id: "p" }))).toBeNull();
  });
});

describe("buildServiceAccountJwt", () => {
  it("signs RS256 claims for the FCM scope that verify with the public key", async () => {
    const jwt = await buildServiceAccountJwt(ACCOUNT, 1_000);
    const [header, claims, signature] = jwt.split(".");

    expect(decodeSegment(header)).toEqual({ alg: "RS256", typ: "JWT" });
    expect(decodeSegment(claims)).toEqual({
      iss: ACCOUNT.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: OAUTH_URL,
      iat: 1_000,
      exp: 4_600,
    });
    expect(signature).not.toMatch(/[+/=]/);

    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${header}.${claims}`);
    expect(
      verifier.verify(publicKey, Buffer.from(signature, "base64url")),
    ).toBe(true);
  });
});

describe("isStaleTokenError", () => {
  it("drops unregistered, mismatched and invalid tokens", () => {
    expect(
      isStaleTokenError({
        error: {
          status: "NOT_FOUND",
          details: [{ errorCode: "UNREGISTERED" }],
        },
      }),
    ).toBe(true);
    expect(
      isStaleTokenError({
        error: { details: [{ errorCode: "SENDER_ID_MISMATCH" }] },
      }),
    ).toBe(true);
    expect(
      isStaleTokenError({
        error: {
          status: "INVALID_ARGUMENT",
          message:
            "The registration token is not a valid FCM registration token",
        },
      }),
    ).toBe(true);
  });

  it("keeps the token for payload, quota and unknown errors", () => {
    expect(
      isStaleTokenError({
        error: {
          status: "INVALID_ARGUMENT",
          message: "Invalid value at 'message.android.priority'",
        },
      }),
    ).toBe(false);
    expect(isStaleTokenError({ error: { status: "RESOURCE_EXHAUSTED" } })).toBe(
      false,
    );
    expect(isStaleTokenError(null)).toBe(false);
    expect(isStaleTokenError("nope")).toBe(false);
  });
});

describe("createFcmSender", () => {
  function fakeGoogle(sendStatus = 200, sendBody: unknown = { name: "x" }) {
    return vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) =>
      String(input) === OAUTH_URL
        ? Response.json({ access_token: "at-1", expires_in: 3600 })
        : Response.json(sendBody, { status: sendStatus }),
    );
  }

  function exchanges(fetch: ReturnType<typeof fakeGoogle>): number {
    return fetch.mock.calls.filter(([url]) => String(url) === OAUTH_URL).length;
  }

  it("exchanges a JWT once and reuses the access token until near expiry", async () => {
    const fetch = fakeGoogle();
    let now = 0;
    const sender = createFcmSender(ACCOUNT, { fetch, now: () => now });

    await expect(sender.send("tok-a", MESSAGE)).resolves.toEqual({ ok: true });
    now = 50 * 60 * 1000; // 50 minutes: before the 55-minute refresh
    await sender.send("tok-b", MESSAGE);
    expect(exchanges(fetch)).toBe(1);

    const [, exchange] = fetch.mock.calls[0];
    const form = new URLSearchParams(String(exchange?.body));
    expect(form.get("grant_type")).toBe(
      "urn:ietf:params:oauth:grant-type:jwt-bearer",
    );
    expect(form.get("assertion")?.split(".")).toHaveLength(3);

    const [sendUrl, send] = fetch.mock.calls[1];
    expect(String(sendUrl)).toBe(
      "https://fcm.googleapis.com/v1/projects/test-project/messages:send",
    );
    expect(new Headers(send?.headers).get("authorization")).toBe("Bearer at-1");
    expect(JSON.parse(String(send?.body))).toEqual({
      message: { token: "tok-a", ...MESSAGE },
    });

    now = 56 * 60 * 1000; // past expiry minus five minutes
    await sender.send("tok-c", MESSAGE);
    expect(exchanges(fetch)).toBe(2);
  });

  it("shares one exchange between concurrent sends", async () => {
    const fetch = fakeGoogle();
    const sender = createFcmSender(ACCOUNT, { fetch, now: () => 0 });

    await Promise.all([
      sender.send("a", MESSAGE),
      sender.send("b", MESSAGE),
      sender.send("c", MESSAGE),
    ]);

    expect(exchanges(fetch)).toBe(1);
  });

  it("reports a dead token as stale", async () => {
    const sender = createFcmSender(ACCOUNT, {
      fetch: fakeGoogle(404, {
        error: {
          status: "NOT_FOUND",
          details: [{ errorCode: "UNREGISTERED" }],
        },
      }),
    });

    await expect(sender.send("gone", MESSAGE)).resolves.toEqual({
      ok: false,
      status: 404,
      staleToken: true,
    });
  });

  it("fails the send when the token exchange is refused", async () => {
    const sender = createFcmSender(ACCOUNT, {
      fetch: vi.fn(async () => new Response("no", { status: 400 })),
    });

    await expect(sender.send("t", MESSAGE)).rejects.toThrow(
      "FCM OAuth token exchange failed: 400",
    );
  });
});
