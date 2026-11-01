/**
 * The sign-in methods on a Kova account, worded for Settings → Account.
 *
 * Kova's `list-accounts` (the SDK's useLinkedAccounts, allowed for app
 * tokens) returns one row per linked provider: "credential" for an email and
 * password, else the OAuth provider id. Passkeys are not rows there, and Kova
 * refuses to list them to app tokens, so they are not shown.
 */

/** Sign-in page order: the provider buttons, then the email form. */
const METHOD_LABELS: ReadonlyArray<readonly [id: string, label: string]> = [
  ["google", "Google"],
  ["discord", "Discord"],
  ["github", "GitHub"],
  ["microsoft", "Microsoft"],
  ["apple", "Apple"],
  ["facebook", "Facebook"],
  ["credential", "Email & password"],
];

/**
 * Provider ids → their labels, in sign-in page order, each once.
 * No rows means the account has only ever used an emailed link, which
 * creates the user without a linked account.
 */
export function signInMethodLabels(providerIds: readonly string[]): string[] {
  const ids = new Set(providerIds.map((id) => id.trim().toLowerCase()));
  ids.delete("");
  if (ids.size === 0) return ["Magic link"];
  const labels: string[] = [];
  for (const [id, label] of METHOD_LABELS) {
    if (ids.delete(id)) labels.push(label);
  }
  // A provider added later (a custom OIDC id) still shows, as named.
  for (const id of [...ids].sort()) {
    labels.push(id.charAt(0).toUpperCase() + id.slice(1));
  }
  return labels;
}
