/** "Ralph HQ" → "RH", "valorant" → "VA": a server tile without an icon. */
export function serverInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters =
    words.length > 1
      ? `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}`
      : name.trim().slice(0, 2);
  return letters.toUpperCase();
}
