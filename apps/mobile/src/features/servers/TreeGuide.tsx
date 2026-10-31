import { View } from "react-native";

import { useTheme } from "@/theme";

interface TreeGuideProps {
  /** x of the vertical stroke inside the row. */
  x: number;
  /** The last child: the stroke stops at the tick. */
  last: boolean;
  /** Draw the 8px tick into the row (off for a stroke passing through). */
  tick?: boolean;
  /** The lit you-are-here path. */
  lit?: boolean;
}

/** 1px guide stroke and 8px tick: the tree is drawn in strokes, not boxes. */
export function TreeGuide({
  x,
  last,
  tick = true,
  lit = false,
}: TreeGuideProps) {
  const theme = useTheme();
  const color = lit ? theme.accentInk : theme.guide;
  return (
    <>
      <View
        style={{
          position: "absolute",
          left: x,
          top: 0,
          bottom: last ? "50%" : 0,
          width: 1,
          backgroundColor: color,
        }}
      />
      {tick ? (
        <View
          style={{
            position: "absolute",
            left: x,
            top: "50%",
            width: 8,
            height: 1,
            backgroundColor: color,
          }}
        />
      ) : null}
    </>
  );
}
