/** Split a user code into display groups ("ABCDEFGH" / "ABCD-EFGH" → ["ABCD","EFGH"]). */
export function splitUserCode(userCode: string): string[] {
  const trimmed = userCode.trim().toUpperCase();
  if (/[-\s]/.test(trimmed)) {
    return trimmed.split(/[-\s]+/).filter(Boolean);
  }
  if (trimmed.length === 8) return [trimmed.slice(0, 4), trimmed.slice(4)];
  return [trimmed];
}

/** Screen-reader friendly spelling: "A B C D, E F G H". */
export function spellUserCode(userCode: string): string {
  return splitUserCode(userCode)
    .map((group) => group.split("").join(" "))
    .join(", ");
}
