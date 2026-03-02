import { dark } from "@clerk/themes";
import { useTheme } from "next-themes";

/**
 * Shared Clerk appearance config that matches the Ralph Meet design system.
 * Use this for any Clerk component (`<SignIn>`, `<SignInButton>`, `<UserButton>`, etc.)
 * to keep theming consistent across the app.
 */
export function useClerkAppearance(forceDark?: boolean) {
  const { resolvedTheme } = useTheme();
  const isDark = forceDark ? true : resolvedTheme === "dark";

  return {
    baseTheme: isDark ? dark : undefined,
    elements: {
      rootBox: "w-full",
      card: "bg-[var(--rm-bg-elevated)] shadow-2xl border border-[var(--rm-border)] w-full rounded-2xl",
      headerTitle: "text-[var(--rm-text-primary)]",
      headerSubtitle: "text-[var(--rm-text-muted)]",
      socialButtonsBlockButton:
        "border border-[var(--rm-border)] bg-[var(--rm-bg-surface)] hover:bg-[var(--rm-bg-hover)] text-[var(--rm-text-primary)] transition-all",
      formButtonPrimary:
        "bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 shadow-lg shadow-indigo-500/20 transition-all",
      footerActionLink: "text-indigo-400 hover:text-indigo-300",
      userButtonPopoverCard:
        "bg-[var(--rm-bg-elevated)] border border-[var(--rm-border)] shadow-2xl",
      userButtonPopoverActionButton:
        "hover:bg-[var(--rm-bg-hover)] text-[var(--rm-text-primary)]",
    },
    variables: {
      colorBackground: "var(--rm-bg-elevated)",
      colorPrimary: "#5865f2",
      colorText: isDark ? "#f2f3f5" : "#060607",
      colorTextSecondary: isDark ? "#b5bac1" : "#4e5058",
      colorInputBackground: "var(--rm-bg-surface)",
      colorInputText: "var(--rm-text-primary)",
      colorDanger: "#ef4444",
    },
  } as const;
}
