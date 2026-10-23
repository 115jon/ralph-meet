/**
 * Columns from the stage's own width (a container query), capped by the
 * participant count. A 456px column at a 768 viewport stays one column for
 * up to four people instead of shrinking tiles below their avatar.
 */
export function gridColumnsClass(count: number): string {
  if (count <= 1) return "grid-cols-1 mx-auto max-w-5xl";
  if (count <= 4) return "grid-cols-1 @min-[560px]:grid-cols-2";
  if (count <= 9)
    return "grid-cols-1 @min-[560px]:grid-cols-2 @min-[1000px]:grid-cols-3";
  if (count <= 16)
    return "grid-cols-2 @min-[720px]:grid-cols-3 @min-[1200px]:grid-cols-4";
  return "grid-cols-2 @min-[720px]:grid-cols-3 @min-[1000px]:grid-cols-4 @min-[1280px]:grid-cols-5 @min-[1536px]:grid-cols-6";
}
