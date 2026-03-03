/**
 * Shim for `@clerk/tanstack-react-start` in the desktop SPA build.
 *
 * With tauri-plugin-clerk, we now have a real Clerk session on desktop.
 * This shim re-exports the actual @clerk/clerk-react components so that
 * all imports of '@clerk/tanstack-react-start' resolve to real Clerk
 * hooks and components — not no-ops.
 */
export {
  ClerkProvider,
  SignIn, SignInButton,
  SignUpButton, SignedIn,
  SignedOut, UserButton,
  useAuth,
  useClerk,
  useUser
} from "@clerk/clerk-react";

