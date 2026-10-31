import { useAppearanceTheme } from "@/components/chat/useAppearanceTheme";

/**
 * Applies (or seeds) the signed-in user's synced theme. Loaded on demand by
 * ThemeProvider, once the chat store exists: it reads the user from that
 * store, so there is nothing for it to do before then.
 */
export default function ThemePreferenceBootstrap() {
  useAppearanceTheme({ enableBootstrap: true });
  return null;
}
