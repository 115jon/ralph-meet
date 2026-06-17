# @kova/react

> Drop-in React SDK for **kova-auth** — the self-hosted [Clerk](https://clerk.com) alternative built on Cloudflare Workers + Better Auth.

## Features

- 🔑 **`<SignIn />`** — email/password, magic link, passkey, OAuth social buttons, inline 2FA challenge
- ✍️ **`<SignUp />`** — email/password registration with live password-strength meter, verify-email state
- 👤 **`<UserButton />`** — avatar trigger with identity header, multi-session switcher, and sign-out
- 🏢 **`<OrgSwitcher />`** — organization picker with instant switch and personal-account fallback
- 🛡️ **`<Protect />`** — declarative route guard (`signed-in`, `signed-out`, or `role="admin"`)
- 🪝 **`useUser`, `useSession`, `useAuth`, `useOrganization`** — reactive auth state hooks
- 🎨 **Appearance API** — CSS-variable-based theming with per-element JS overrides; zero extra CSS required
- 📦 **Dual ESM + CJS** with full TypeScript declarations
- 🪶 **Zero runtime dependencies** beyond `better-auth` (peer: `react ≥ 18`)

---

## Installation

```bash
pnpm add @kova/react better-auth
# or
npm install @kova/react better-auth
```

---

## Quick Start

### 1. Wrap your app

```tsx
// src/main.tsx
import { KovaAuthProvider } from "@kova/react";
import { createRoot } from "react-dom/client";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <KovaAuthProvider
    publishableKey="pk_live_eyJ2Ij..."  // from your kova-auth dashboard
    afterSignInUrl="/dashboard"
    afterSignUpUrl="/onboarding"
    afterSignOutUrl="/sign-in"
  >
    <App />
  </KovaAuthProvider>
);
```

Or, if you don't have a publishable key yet, pass `authUrl` directly:

```tsx
<KovaAuthProvider authUrl="https://auth.example.com">
  <App />
</KovaAuthProvider>
```

### 2. Drop in auth components

```tsx
// src/pages/sign-in.tsx
import { SignIn } from "@kova/react";

export function SignInPage() {
  return (
    <div style={{ display: "flex", justifyContent: "center", paddingTop: 80 }}>
      <SignIn afterSignInUrl="/dashboard" signUpUrl="/sign-up" />
    </div>
  );
}
```

```tsx
// src/pages/sign-up.tsx
import { SignUp } from "@kova/react";

export function SignUpPage() {
  return <SignUp afterSignUpUrl="/onboarding" signInUrl="/sign-in" />;
}
```

### 3. Add a user button to your nav

```tsx
import { UserButton } from "@kova/react";

function Navbar() {
  return (
    <nav>
      <Logo />
      <UserButton showName afterSignOutUrl="/sign-in" />
    </nav>
  );
}
```

### 4. Protect routes

```tsx
import { Protect } from "@kova/react";
import { Navigate } from "react-router-dom";

// Require sign-in
<Protect fallback={<Navigate to="/sign-in" />}>
  <Dashboard />
</Protect>

// Require admin role
<Protect role="admin" fallback={<p>Access denied</p>}>
  <AdminPanel />
</Protect>

// Redirect signed-in users away from auth pages
<Protect condition="signed-out" fallback={<Navigate to="/dashboard" />}>
  <SignIn />
</Protect>
```

---

## Hooks

| Hook | Description |
|------|-------------|
| `useAuth()` | `isLoaded`, `isSignedIn`, `userId`, `signOut` |
| `useUser()` | `user`, `isSignedIn`, `updateUser` |
| `useSession()` | Full session + user object |
| `useOrganization()` | Active org, membership, role |
| `useSignIn()` | Imperative `signIn.email / magicLink / social / passkey / totp` |
| `useSignUp()` | Imperative `signUp.email`, `verificationPending` |

```tsx
import { useUser } from "@kova/react";

function Profile() {
  const { user, isLoaded, isSignedIn } = useUser();
  if (!isLoaded) return <Spinner />;
  if (!isSignedIn) return <p>Not signed in</p>;
  return <h1>Hello, {user.name}!</h1>;
}
```

---

## Appearance API

Customize every token globally (on the provider) or per-component:

```tsx
<KovaAuthProvider
  publishableKey="pk_live_..."
  appearance={{
    variables: {
      colorPrimary: "#7c3aed",          // Violet instead of blue
      colorBackground: "#0f0f1a",
      colorSurface: "#16162a",
      borderRadius: "12px",
    },
  }}
>
  <App />
</KovaAuthProvider>
```

Override individual elements (merged on top of provider appearance):

```tsx
<SignIn
  appearance={{
    elements: {
      card: { boxShadow: "none", border: "none" },
      formSubmitButton: { letterSpacing: "0.05em", textTransform: "uppercase" },
    },
  }}
/>
```

All elements are also addressable via the `data-ra-element` attribute in plain CSS:

```css
[data-ra-element="formSubmitButton"] {
  background: linear-gradient(135deg, #7c3aed, #3b82f6);
}
```

---

## Publishable Key

Generate a key for your auth server URL:

```ts
import { encodePublishableKey, decodePublishableKey } from "@kova/react";

// Encode
const key = encodePublishableKey("https://auth.example.com", { mode: "live" });
// → "pk_live_eyJ2IjoxLCJhdXRoVXJsIjoiaHR0cHM6Ly9hdXRoLmV4YW1wbGUuY29tIn0="

// Decode
const { authUrl, mode } = decodePublishableKey(key);
```

---

## Imperative Client

For use outside React (e.g., loaders, middleware):

```ts
import { createKovaAuthClient } from "@kova/react";

export const authClient = createKovaAuthClient({
  authUrl: "https://auth.example.com",
  plugins: {
    organization: { teams: true },
    multiSession: true,
  },
});

// In a route loader:
const { data: session } = await authClient.getSession();
```

---

## Plugin Configuration

All plugins from the kova-auth server are enabled by default. Opt out selectively:

```tsx
<KovaAuthProvider
  publishableKey="pk_live_..."
  plugins={{
    admin: false,      // disable admin client
    apiKey: false,     // disable API key client
    passkey: false,    // disable WebAuthn
  }}
/>
```

---

## Architecture

```
@kova/react
├── KovaAuthProvider   — context, CSS injection, client creation
├── Components          — SignIn / SignUp / UserButton / OrgSwitcher / Protect
│   ├── ui.tsx          — shared primitives (Card, FormField, Alert, Avatar, Spinner…)
│   └── icons.tsx       — inline SVG icons (no external icon lib)
├── Hooks               — useAuth / useUser / useSession / useOrganization / useSignIn / useSignUp
├── client.ts           — createKovaAuthClient (wraps better-auth/react)
├── key.ts              — publishable key encode/decode
└── styles/inject.ts    — CSS custom-property injection
```

All components use `data-ra-element` attributes and CSS custom properties (`--ra-*`) for zero-config theming that degrades cleanly without JavaScript.
