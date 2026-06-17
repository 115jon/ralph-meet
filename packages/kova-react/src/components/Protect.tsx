/**
 * <Protect /> — declarative route / component guard.
 *
 * Renders `children` only when the auth condition is satisfied. During
 * the initial session load the `loading` slot is shown (defaults to null
 * so there's no layout shift). When the condition fails, `fallback` is
 * rendered (defaults to null — the component simply disappears).
 *
 * @example
 * ```tsx
 * // Require any sign-in:
 * <Protect fallback={<Navigate to="/sign-in" />}>
 *   <Dashboard />
 * </Protect>
 *
 * // Require admin role:
 * <Protect role="admin" fallback={<p>Access denied</p>}>
 *   <AdminPanel />
 * </Protect>
 *
 * // Auth page — redirect away if already signed in:
 * <Protect condition="signed-out" fallback={<Navigate to="/dashboard" />}>
 *   <SignIn />
 * </Protect>
 * ```
 */

import { useAuth } from "../hooks/use-auth";
import { useUser } from "../hooks/use-user";
import type { ProtectProps } from "../types";

export function Protect({
  condition = "signed-in",
  role,
  fallback = null,
  loading = null,
  children,
}: ProtectProps) {
  const { isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();

  // Still resolving initial session
  if (!isLoaded) return <>{loading}</>;

  // Evaluate the condition
  let conditionMet: boolean;

  if (condition === "signed-out") {
    // Guard for auth-only pages (e.g., /sign-in should redirect authed users away)
    conditionMet = !isSignedIn;
  } else {
    // Default: require authentication
    conditionMet = isSignedIn;

    // Additional role check
    if (conditionMet && role) {
      const userRoles = (user?.role ?? "")
        .split(",")
        .map((r: string) => r.trim())
        .filter((r: string) => r.length > 0);
      conditionMet = userRoles.includes(role);
    }
  }

  if (!conditionMet) return <>{fallback}</>;
  return <>{children}</>;
}
