/** Screen share fixture surfaces (see stream-fixtures.tsx). */
export function isStreamFixture(surface: string) {
  return surface.startsWith("st-");
}
