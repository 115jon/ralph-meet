# Desktop Auth Handoff Bugfix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task.

**Goal:** Fix desktop browser sign-in so unauthenticated users see the real web sign-in form instead of an `Auth token: missing` native fallback, and prevent the desktop login button from waiting forever.

**Architecture:** Keep the current native handoff flow. The web sign-in page should try a fast cookie-based native token handoff first, but if that fails and the browser is signed out, it must render the `SignIn` component instead of opening `ralphmeet://auth` without a token. The desktop app should keep listening for late deep links, but its button state should time out and become actionable again.

**Tech Stack:** React 19, TanStack Router, Kova Auth, Tauri deep links, Vitest, pnpm.

---

## Root Cause

The desktop app opens this URL in the system browser:

```text
https://meet.115jon.site/sign-in?redirect_url=ralphmeet%3A%2F%2Fauth&native_handoff=1
```

In `src/routes/sign-in.tsx`, native handoff currently does two separate things:

- It starts a cookie-based handoff attempt via `getAppScopedSessionToken(null)`.
- It runs the post-sign-in redirect effect when `nativeCookieHandoffChecked` becomes true, even if the browser is loaded and signed out.

That means an unauthenticated browser can finish the failed cookie probe, mark `nativeCookieHandoffChecked=true`, then immediately call `withSessionToken(...)`, fail to attach a token, set `nativeRedirectTarget` to plain `ralphmeet://auth`, and render the fallback card with `Auth token: missing` instead of showing the real web sign-in form.

Separately, `src/components/DesktopLogin.tsx` sets `status="waiting"` after opening the browser and only exits that state on a successful deep link or an opener error. If the browser auth flow is abandoned, blocked, or returns without a valid token, the button remains disabled indefinitely.

## Expected Behavior

- Browser is not signed in: desktop opens `/sign-in?...native_handoff=1`, web briefly checks for an existing cookie session, then renders the Kova `SignIn` UI.
- Browser is already signed in: web mints an app-scoped session token and opens `ralphmeet://auth?session_token=...` or shows the fallback button with `Auth token: attached` if the browser blocks the protocol launch.
- Desktop app waiting state: clicking sign in disables the button while waiting, then returns to an actionable state after a bounded timeout if no token arrives.
- Late deep link after timeout: desktop should still accept the token and navigate to chat.

---

### Task 1: Add Pure Native Handoff Decision Helpers

**Files:**

- Create: `src/lib/native-auth-handoff.ts`
- Create: `src/lib/__tests__/native-auth-handoff.test.ts`

**Step 1: Write the failing tests**

Create `src/lib/__tests__/native-auth-handoff.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  getSignInRenderState,
  shouldCompletePostSignInRedirect,
} from "@/lib/native-auth-handoff";

describe("native auth handoff decisions", () => {
  it("renders the sign-in form after native cookie handoff fails while the browser is signed out", () => {
    expect(
      shouldCompletePostSignInRedirect({
        isNativeHandoff: true,
        isLoaded: true,
        isSignedIn: false,
        hasStoredBrowserToken: false,
      }),
    ).toBe(false);

    expect(
      getSignInRenderState({
        isNativeHandoff: true,
        nativeCookieHandoffChecked: true,
        isLoaded: true,
        isSignedIn: false,
        hasAuthTransferCode: false,
      }),
    ).toBe("form");
  });

  it("keeps the native preparing screen while the cookie handoff check is still pending", () => {
    expect(
      getSignInRenderState({
        isNativeHandoff: true,
        nativeCookieHandoffChecked: false,
        isLoaded: true,
        isSignedIn: false,
        hasAuthTransferCode: false,
      }),
    ).toBe("native-preparing");
  });

  it("continues native handoff when the browser is signed in", () => {
    expect(
      shouldCompletePostSignInRedirect({
        isNativeHandoff: true,
        isLoaded: true,
        isSignedIn: true,
        hasStoredBrowserToken: false,
      }),
    ).toBe(true);

    expect(
      getSignInRenderState({
        isNativeHandoff: true,
        nativeCookieHandoffChecked: true,
        isLoaded: true,
        isSignedIn: true,
        hasAuthTransferCode: false,
      }),
    ).toBe("native-preparing");
  });

  it("keeps existing web redirect behavior for stored browser tokens", () => {
    expect(
      shouldCompletePostSignInRedirect({
        isNativeHandoff: false,
        isLoaded: false,
        isSignedIn: false,
        hasStoredBrowserToken: true,
      }),
    ).toBe(true);
  });

  it("uses the splash state for normal web auth loading", () => {
    expect(
      getSignInRenderState({
        isNativeHandoff: false,
        nativeCookieHandoffChecked: false,
        isLoaded: false,
        isSignedIn: false,
        hasAuthTransferCode: false,
      }),
    ).toBe("splash");
  });
});
```

**Step 2: Run the failing tests**

Run:

```bash
pnpm test src/lib/__tests__/native-auth-handoff.test.ts
```

Expected: fail because `@/lib/native-auth-handoff` does not exist yet.

**Step 3: Add the helper implementation**

Create `src/lib/native-auth-handoff.ts`:

```ts
export type SignInRenderState = "native-preparing" | "splash" | "form";

export type SignInRedirectDecisionInput = {
  isNativeHandoff: boolean;
  isLoaded: boolean;
  isSignedIn: boolean;
  hasStoredBrowserToken: boolean;
};

export function shouldCompletePostSignInRedirect({
  isNativeHandoff,
  isLoaded,
  isSignedIn,
  hasStoredBrowserToken,
}: SignInRedirectDecisionInput): boolean {
  if (isNativeHandoff) {
    return isLoaded && isSignedIn;
  }

  return hasStoredBrowserToken || (isLoaded && isSignedIn);
}

export type SignInRenderDecisionInput = {
  isNativeHandoff: boolean;
  nativeCookieHandoffChecked: boolean;
  isLoaded: boolean;
  isSignedIn: boolean;
  hasAuthTransferCode: boolean;
};

export function getSignInRenderState({
  isNativeHandoff,
  nativeCookieHandoffChecked,
  isLoaded,
  isSignedIn,
  hasAuthTransferCode,
}: SignInRenderDecisionInput): SignInRenderState {
  if (
    isNativeHandoff &&
    (!nativeCookieHandoffChecked || !isLoaded || isSignedIn || hasAuthTransferCode)
  ) {
    return "native-preparing";
  }

  if (!isLoaded || isSignedIn || hasAuthTransferCode) {
    return "splash";
  }

  return "form";
}
```

**Step 4: Run the tests again**

Run:

```bash
pnpm test src/lib/__tests__/native-auth-handoff.test.ts
```

Expected: pass.

---

### Task 2: Use The Helpers In The Web Sign-In Route

**Files:**

- Modify: `src/routes/sign-in.tsx`
- Test: `src/lib/__tests__/native-auth-handoff.test.ts`

**Step 1: Import the helpers**

Add this import near the other local imports in `src/routes/sign-in.tsx`:

```ts
import {
  getSignInRenderState,
  shouldCompletePostSignInRedirect,
} from "@/lib/native-auth-handoff";
```

**Step 2: Define the auth transfer code flag**

After `isNativeHandoff` is computed, add:

```ts
const hasAuthTransferCode = !!(kova_auth_code || ralph_auth_code);
```

**Step 3: Replace the redirect effect trigger**

Replace the current effect trigger block:

```ts
if (isNativeHandoff) {
  if (nativeCookieHandoffChecked || (isLoaded && isSignedIn)) {
    void completeRedirect();
  }
} else if (storedBrowserToken || (isLoaded && isSignedIn)) {
  void completeRedirect();
}
```

With:

```ts
if (
  shouldCompletePostSignInRedirect({
    isNativeHandoff,
    isLoaded,
    isSignedIn,
    hasStoredBrowserToken: !!storedBrowserToken,
  })
) {
  void completeRedirect();
}
```

This is the behavior fix. `nativeCookieHandoffChecked` should decide whether the page can stop showing the preparing screen. It should not be enough to launch a native redirect when the browser is signed out.

**Step 4: Remove the stale dependency**

In the redirect effect dependency array, remove `nativeCookieHandoffChecked` because the effect no longer reads it.

**Step 5: Replace the render conditionals with the helper**

Before the existing render returns, compute:

```ts
const signInRenderState = getSignInRenderState({
  isNativeHandoff,
  nativeCookieHandoffChecked,
  isLoaded,
  isSignedIn,
  hasAuthTransferCode,
});
```

Replace:

```ts
if (
  isNativeHandoff &&
  (!nativeCookieHandoffChecked || !isLoaded || isSignedIn || kova_auth_code || ralph_auth_code)
) {
  return <NativeRedirectPreparing />;
}

if (!isLoaded || isSignedIn || kova_auth_code || ralph_auth_code) {
  return <SplashScreen />;
}
```

With:

```ts
if (signInRenderState === "native-preparing") {
  return <NativeRedirectPreparing />;
}

if (signInRenderState === "splash") {
  return <SplashScreen />;
}
```

**Step 6: Run focused tests**

Run:

```bash
pnpm test src/lib/__tests__/native-auth-handoff.test.ts
```

Expected: pass.

---

### Task 3: Add A Desktop Login Wait Timeout

**Files:**

- Modify: `src/components/DesktopLogin.tsx`

**Step 1: Extend imports and status type**

Change the React import:

```ts
import { useCallback, useEffect, useRef, useState } from "react";
```

Change the status state type:

```ts
const [status, setStatus] = useState<"resolving" | "idle" | "waiting" | "timed-out" | "error">("resolving");
```

**Step 2: Add a timeout constant**

Near the logger, add:

```ts
const DESKTOP_LOGIN_WAIT_TIMEOUT_MS = 120_000;
```

**Step 3: Add timeout management inside `DesktopLogin`**

Near the top of the component, after `useNavigate()`, add:

```ts
const loginWaitTimeoutRef = useRef<number | null>(null);

const clearLoginWaitTimeout = useCallback(() => {
  if (loginWaitTimeoutRef.current === null) return;
  window.clearTimeout(loginWaitTimeoutRef.current);
  loginWaitTimeoutRef.current = null;
}, []);

const startLoginWaitTimeout = useCallback(() => {
  clearLoginWaitTimeout();
  loginWaitTimeoutRef.current = window.setTimeout(() => {
    loginWaitTimeoutRef.current = null;
    setStatus((current) => (current === "waiting" ? "timed-out" : current));
  }, DESKTOP_LOGIN_WAIT_TIMEOUT_MS);
}, [clearLoginWaitTimeout]);

useEffect(() => clearLoginWaitTimeout, [clearLoginWaitTimeout]);
```

**Step 4: Clear the timeout on success or terminal failure**

At the start of `completeDesktopLogin`, add:

```ts
clearLoginWaitTimeout();
```

Update the callback dependency array for `completeDesktopLogin` to include `clearLoginWaitTimeout`.

In the `activateCode` catch block, add `clearLoginWaitTimeout();` before `setStatus("error")`.

Update the callback dependency array for `activateCode` to include `clearLoginWaitTimeout`.

In `handleSignIn`, after `setStatus("waiting")`, add:

```ts
startLoginWaitTimeout();
```

In every error path in `handleSignIn` that sets `status` to `error`, call `clearLoginWaitTimeout()` first.

Update the callback dependency array for `handleSignIn` to include `clearLoginWaitTimeout` and `startLoginWaitTimeout`.

**Step 5: Make the timed-out state actionable**

Change the button label expression to:

```tsx
{status === "waiting"
  ? "Waiting for sign-in..."
  : status === "timed-out"
    ? "Try signing in again"
    : "Sign in with your browser"}
```

Keep `disabled={status === "waiting"}` so the button is enabled after timeout.

Add this message below the waiting message block:

```tsx
{status === "timed-out" && (
  <p className="text-xs text-amber-300 text-center">
    Sign-in timed out. You can try again, or finish the browser sign-in if it is still open.
  </p>
)}
```

**Step 6: Preserve late deep-link acceptance**

Do not remove or gate the existing deep-link listeners. If a token arrives after the UI times out, `completeDesktopLogin` should still validate it and navigate to `/chat`.

---

### Task 4: Verify The Full Fix

**Files:**

- Verify: `src/routes/sign-in.tsx`
- Verify: `src/components/DesktopLogin.tsx`
- Verify: `src/lib/native-auth-handoff.ts`

**Step 1: Run focused unit tests**

Run:

```bash
pnpm test src/lib/__tests__/native-auth-handoff.test.ts
```

Expected: pass.

**Step 2: Run type checking**

Run:

```bash
pnpm typecheck
```

Expected: pass.

**Step 3: Run lint**

Run:

```bash
pnpm lint
```

Expected: pass or only pre-existing unrelated warnings. If lint fails on touched files, fix those before continuing.

**Step 4: Manually verify unauthenticated browser behavior**

Open this URL in a browser profile that is not signed in to Ralph Auth:

```text
https://meet.115jon.site/sign-in?redirect_url=ralphmeet%3A%2F%2Fauth&native_handoff=1
```

Expected: the page may briefly show `Preparing Ralph Meet`, then it shows the actual web sign-in form. It must not show `Return to Ralph Meet` with `Auth token: missing` before the user signs in.

**Step 5: Manually verify signed-in browser behavior**

Open the same URL in a browser profile that is already signed in to Ralph Auth.

Expected: the page mints a native handoff token and opens the desktop app. If the browser blocks the custom protocol launch, the fallback card may appear, but it must say `Auth token: attached`.

**Step 6: Manually verify desktop timeout behavior**

Launch the desktop app, click `Sign in with your browser`, and do not complete browser sign-in.

Expected after 120 seconds: the button is enabled again and says `Try signing in again`, with the timeout message visible.

**Step 7: Manually verify late completion behavior**

After the desktop timeout message appears, complete sign-in in the browser if the auth page is still open.

Expected: the desktop app still accepts the eventual deep link token and navigates to `/chat`.

---

## Risk Notes

- This plan intentionally does not change the `ralphmeet://auth` protocol, Rust deep-link forwarding, or token exchange endpoints.
- The only auth-flow semantic change is that a failed native cookie probe no longer counts as permission to open the native app without a token.
- The desktop timeout only affects button state. It does not cancel deep-link listeners or reject late tokens.
