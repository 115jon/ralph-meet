/**
 * Icon size scale, in CSS pixels. Phosphor Bold strokes are 24/256 of the box,
 * so each step also sets the rendered line: 1.1px at xs, 1.5 at sm, 1.7 at
 * md, 1.9 at lg, 2.25 at xl.
 *
 *   xs  12  chevrons, inline status inside 11-12px text
 *   sm  16  menus, inline actions, 13-14px text
 *   md  18  channel rows, settings nav, 15px row text
 *   lg  20  header, message hover bar, composer (in 32px targets)
 *   xl  24  server rail, voice dock (in 44px targets)
 *
 * Two display steps are for illustrative glyphs in empty states and
 * placeholders only, never for controls:
 *
 *   2xl 32
 *   3xl 48
 */
export const ICON_SIZE = {
  xs: 12,
  sm: 16,
  md: 18,
  lg: 20,
  xl: 24,
  "2xl": 32,
  "3xl": 48,
} as const;

export type IconSize = keyof typeof ICON_SIZE;
