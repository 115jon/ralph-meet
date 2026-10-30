type RoleLike = {
  color: string | null;
  position: number;
  is_default?: boolean;
};

/**
 * The name colour a member wears: the colour of their highest coloured role,
 * like Discord. Default (@everyone) and colourless roles never colour a name.
 * Pair the result with the `.rm-role-name` class so light themes darken it.
 */
export function getRoleNameColor(
  roles: readonly RoleLike[] | undefined | null,
): string | null {
  if (!roles || roles.length === 0) return null;
  let best: RoleLike | null = null;
  for (const role of roles) {
    if (role.is_default || !role.color) continue;
    if (!best || role.position > best.position) best = role;
  }
  return best?.color ?? null;
}
