/** Screen share fixture surfaces (see stream-fixtures.tsx). */
export function isStreamFixture(surface: string) {
  return surface.startsWith("st-");
}

/** Floating player fixture surfaces (see floating-fixtures.tsx). */
export function isFloatingFixture(surface: string) {
  return surface.startsWith("fl-");
}
