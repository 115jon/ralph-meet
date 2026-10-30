import { memo, useId, type SVGProps } from "react";
import { BOLD, FILL, type GlyphPaths } from "./glyphs.generated";
import {
  ICONS,
  OFF_PAIR,
  type GlyphSpec,
  type IconName,
  type StatefulIconName,
} from "./mapping";
import { ICON_SIZE, type IconSize } from "./tokens";

/**
 * idle    Bold. The default for every icon.
 * active  Fill of the same drawing: on, selected, live, open.
 * off     Fill of the concept's "off" partner (mic -> micOff, camera ->
 *         cameraOff, deafen -> deafenOff, bell -> bellOff): muted, deafened.
 *
 * A state change is the same drawing at another weight, so it never relies
 * on colour alone. Colour stays in CSS through currentColor.
 */
export type IconState = "idle" | "active" | "off";

type SvgPassThrough = Omit<
  SVGProps<SVGSVGElement>,
  "children" | "ref" | "name" | "width" | "height" | "viewBox" | "fill"
>;

export type IconProps<N extends IconName = IconName> = SvgPassThrough & {
  /** An app concept from mapping.ts, never a glyph name. */
  name: N;
  /** Only concepts that ship a Fill weight accept a non-idle state. */
  state?: N extends StatefulIconName ? IconState : "idle";
  /** A step on the icon scale (tokens.ts). Defaults to `md` (18px). */
  size?: IconSize;
  /**
   * Accessible name for a standalone meaningful glyph (rendered as
   * role="img"). Leave unset inside a labelled control: the button carries
   * the meaning and the icon stays aria-hidden.
   */
  label?: string;
};

/** Phosphor's own slash: corner to corner of the glyph's live area. */
const SLASH_PATH = "M48 40 208 216";
/** Stroke widths in grid units: Bold is 24/256 of the box, Fill uses 16. */
const SLASH_WIDTH = { bold: 24, fill: 16 } as const;
/** Clear band cut through the glyph on each side of the slash. */
const SLASH_GAP = 12;

function resolvePaths(glyph: string, solid: boolean): GlyphPaths {
  if (solid) {
    const paths = FILL[glyph];
    if (paths) return paths;
    if (import.meta.env.DEV) {
      console.warn(
        `Icon: "${glyph}" has no Fill weight. Add \`fill: true\` to its concept in mapping.ts and run \`pnpm icons:generate\`.`,
      );
    }
  }
  return BOLD[glyph] ?? [];
}

function IconImpl<N extends IconName>({
  name,
  state = "idle" as IconProps<N>["state"],
  size = "md",
  label,
  className,
  ...rest
}: IconProps<N>) {
  const maskId = `rm-icon-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const resolved: IconName =
    state === "off" ? (OFF_PAIR[name as keyof typeof OFF_PAIR] ?? name) : name;
  const spec: GlyphSpec = ICONS[resolved];
  const solid = state !== "idle";
  const px = ICON_SIZE[size];
  const paths = resolvePaths(spec.glyph, solid).map((d) => (
    <path key={d} d={d} />
  ));

  const slashWidth = solid ? SLASH_WIDTH.fill : SLASH_WIDTH.bold;
  const transform = spec.rotate ? `rotate(${spec.rotate} 128 128)` : undefined;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 256 256"
      width={px}
      height={px}
      fill="currentColor"
      focusable="false"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      data-icon={resolved}
      data-state={state}
      className={className}
      {...rest}
    >
      {spec.slash ? (
        <>
          <mask id={maskId} maskUnits="userSpaceOnUse">
            <rect width="256" height="256" fill="#fff" />
            <path
              d={SLASH_PATH}
              stroke="#000"
              strokeWidth={slashWidth + SLASH_GAP * 2}
              strokeLinecap="round"
            />
          </mask>
          <g mask={`url(#${maskId})`} transform={transform}>
            {paths}
          </g>
          <path
            d={SLASH_PATH}
            fill="none"
            stroke="currentColor"
            strokeWidth={slashWidth}
            strokeLinecap="round"
          />
        </>
      ) : transform ? (
        <g transform={transform}>{paths}</g>
      ) : (
        paths
      )}
    </svg>
  );
}

/**
 * The app's only icon component. Phosphor Bold at rest, Fill for state.
 *
 *   <Icon name="mic" state={muted ? "off" : "idle"} size="xl" />
 *
 * Decorative by default (aria-hidden). An icon-only control names itself
 * (IconButton requires it); pass `label` only for a glyph that carries
 * meaning on its own.
 */
export const Icon = memo(IconImpl) as typeof IconImpl;
