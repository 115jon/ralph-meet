"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Talk Tree guides (talk-tree-spec §5c).
 *
 *   <TreeBranch header={<VoiceChannelRow />}>
 *     <TreeLeaf node={<Led state="talk" follow="speaking" />} {...useSpeakingAttr(id)}>
 *       <Avatar … size={18} /> Ada
 *     </TreeLeaf>
 *     <TreeLeaf self node={…}>…</TreeLeaf>
 *   </TreeBranch>
 *
 * Every leaf draws its own segments in CSS (styles/foundation.css): up from
 * the row top to its middle, an 8px tick to its node, and, unless it is the
 * last child, down to the next sibling. Nothing is measured. A leaf marked
 * `self` or `current` lights its segments and every earlier sibling's trunk
 * in --path, up to the branch root; a leaf that holds a nested TreeBranch
 * containing the path lights too. The path's own node (its unlit LED) fills
 * in --path, so "you" reads at a glance; a lit LED (talk) still wins.
 *
 * Join motion: a row inserted after the branch's first paint fades in 4px
 * from above (200ms) and its segments draw from their origin (160ms, 40ms
 * late). The initial render never animates; the branch sets
 * `data-animate-enter` after first paint. For leave, wrap the store update in
 * `document.startViewTransition` and give rows `view-transition-class:
 * list-row` (styles/motion.css).
 */

/** True after the first paint: gate `@starting-style` entrances on it. */
export function useAnimateEnter(enabled = true): boolean {
  const [ready, setReady] = React.useState(false);
  React.useEffect(() => {
    if (!enabled) return;
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setReady(true));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [enabled]);
  return enabled && ready;
}

type TreeBranchProps = Omit<React.ComponentProps<"div">, "children"> & {
  /** The branch's own row (a voice channel row, a category label). */
  header?: React.ReactNode;
  children?: React.ReactNode;
  /**
   * x of the trunk inside each child, in px. Default 16: the centre of a
   * 16px icon in a `px-2` row, so the trunk drops from the header's icon.
   */
  guideX?: number;
  /** Height of each child's own row, in px. Default 24 (occupant rows). */
  rowHeight?: number;
  /**
   * Gap in px between the header's glyph and the first child, bridged by the
   * first child's upper trunk so the path runs unbroken from the glyph.
   * Default 0.
   */
  stem?: number;
  /** Animate rows inserted after first paint. Default true. */
  animateEnter?: boolean;
  /** Classes for the children container. */
  childrenClassName?: string;
};

function TreeBranch({
  header,
  children,
  guideX = 16,
  rowHeight = 24,
  stem = 0,
  animateEnter = true,
  className,
  childrenClassName,
  ...props
}: TreeBranchProps) {
  const ready = useAnimateEnter(animateEnter);
  return (
    <div
      data-slot="tree-branch"
      data-animate-enter={ready ? "" : undefined}
      className={cn("relative", className)}
      {...props}
    >
      {header}
      <div
        role="group"
        data-slot="tree-children"
        className={cn("flex flex-col", childrenClassName)}
        style={
          {
            "--tree-guide-x": `${guideX}px`,
            "--tree-row-h": `${rowHeight}px`,
            "--tree-stem": `${stem}px`,
          } as React.CSSProperties
        }
      >
        {children}
      </div>
    </div>
  );
}

type TreeLeafProps = Omit<React.ComponentProps<"div">, "children"> & {
  /** The node at the tick's end, usually the person's <Led>. */
  node?: React.ReactNode;
  /** You: lights the path from here up to the branch root. */
  self?: boolean;
  /** The current location (aria-current="true"): also lights the path. */
  current?: boolean;
  /** Force last-child geometry (no lower trunk) when it isn't the DOM's last child. */
  last?: boolean;
  /** A nested TreeBranch hanging under this leaf's row. */
  branch?: React.ReactNode;
  /** Classes for the row (the leaf's own line). */
  rowClassName?: string;
  children?: React.ReactNode;
};

const TreeLeaf = React.forwardRef<HTMLDivElement, TreeLeafProps>(
  function TreeLeaf(
    {
      node,
      self = false,
      current = false,
      last = false,
      branch,
      className,
      rowClassName,
      children,
      ...props
    },
    ref,
  ) {
    return (
      <div
        ref={ref}
        data-slot="tree-leaf"
        data-self={self ? "" : undefined}
        data-path-end={self || current ? "" : undefined}
        data-last={last ? "" : undefined}
        aria-current={current ? "true" : undefined}
        className={cn("rm-tree-item", className)}
        {...props}
      >
        <span aria-hidden="true" className="rm-tree-guide" data-seg="up" />
        <span aria-hidden="true" className="rm-tree-guide" data-seg="down" />
        <span aria-hidden="true" className="rm-tree-guide" data-seg="tick" />
        <div
          data-slot="tree-row"
          className={cn(
            "relative flex h-(--rm-tree-rh) min-w-0 items-center gap-1.5 pl-[calc(var(--rm-tree-gx)+var(--rm-tree-tick))]",
            rowClassName,
          )}
        >
          {node ? (
            <span data-slot="tree-node" className="flex shrink-0 items-center">
              {node}
            </span>
          ) : null}
          {children}
        </div>
        {branch}
      </div>
    );
  },
);

export { TreeBranch, TreeLeaf };
