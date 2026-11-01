import { appPathOf, parseAppLink } from "@/features/links/parse";
import { config } from "@/lib/config";

/**
 * Links Android hands the app (App Links on the web host, or the scheme):
 * the web's /invite/CODE and /chat/SERVER/CHANNEL?message=ID become the
 * app's /invite/[code], /channel/[id] and /dm/[id]. Anything else, the dev
 * client's own links included, passes through unchanged.
 */
export function redirectSystemPath({
  path,
}: {
  path: string;
  initial: boolean;
}) {
  try {
    const link = parseAppLink(path, {
      web: config.webUrl,
      scheme: config.scheme,
    });
    return link ? appPathOf(link) : path;
  } catch {
    return path;
  }
}
