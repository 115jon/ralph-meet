/**
 * Shim for `@clerk/tanstack-react-start` in the desktop SPA build.
 *
 * The desktop client uses token-based auth instead of Clerk's SSR
 * integration. This shim provides no-op stubs for all Clerk components
 * and hooks used throughout the shared route/component code.
 */
import type { ReactNode } from "react";

/** No-op ClerkProvider — desktop uses token auth, no Clerk session. */
export function ClerkProvider({ children }: { children: ReactNode }) {
  return children;
}

/** No-op SignIn — desktop uses browser-based OAuth flow. */
export function SignIn() {
  return null;
}

/** No-op useAuth — always returns unauthenticated for Clerk. */
export function useAuth() {
  return {
    isLoaded: true,
    isSignedIn: false,
    userId: null,
    sessionId: null,
    getToken: async () => null,
  };
}

/** No-op useUser — always returns null user. */
export function useUser() {
  return {
    isLoaded: true,
    isSignedIn: false,
    user: null,
  };
}

/** No-op useClerk */
export function useClerk() {
  return {
    signOut: async () => { },
    openSignIn: () => { },
    loaded: true,
  };
}

/** No-op SignedIn — renders children unconditionally in desktop mode. */
export function SignedIn({ children }: { children: ReactNode }) {
  return children;
}

/** No-op SignedOut — never renders in desktop mode. */
export function SignedOut() {
  return null;
}

/** No-op UserButton */
export function UserButton() {
  return null;
}

/** No-op SignInButton */
export function SignInButton({ children }: { children?: ReactNode }) {
  return children ?? null;
}

/** No-op SignUpButton */
export function SignUpButton({ children }: { children?: ReactNode }) {
  return children ?? null;
}
