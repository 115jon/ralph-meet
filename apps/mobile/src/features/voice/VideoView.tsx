import { useEffect, useState } from "react";
import { PixelRatio, StyleSheet } from "react-native";
import { RTCView } from "react-native-webrtc";

import { newRenderOwner, reportRender, withdrawRender } from "./render-demand";
import { setVideoSize } from "./video-size";

interface VideoViewProps {
  streamURL: string;
  /** contain for screens (nothing cropped), cover for cameras. */
  fit: "contain" | "cover";
  /** Only our own front camera; remote video always shows as sent. */
  mirror?: boolean;
}

/**
 * A video filling its tile. Loaded with React.lazy from the tiles, so
 * react-native-webrtc stays out of the app until a call has video. Reports
 * its size in pixels so a web camera is pulled at the layer it needs.
 */
export default function VideoView({
  streamURL,
  fit,
  mirror = false,
}: VideoViewProps) {
  const [owner] = useState(newRenderOwner);
  const [layout, setLayout] = useState<{
    width: number;
    height: number;
  } | null>(null);

  useEffect(() => {
    const scale = PixelRatio.get();
    reportRender(
      owner,
      streamURL,
      layout
        ? {
            width: Math.round(layout.width * scale),
            height: Math.round(layout.height * scale),
          }
        : null,
    );
  }, [owner, streamURL, layout]);

  useEffect(() => () => withdrawRender(owner), [owner]);

  return (
    <RTCView
      streamURL={streamURL}
      objectFit={fit}
      mirror={mirror}
      onDimensionsChange={(event) => setVideoSize(streamURL, event.nativeEvent)}
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        setLayout((previous) =>
          previous?.width === width && previous.height === height
            ? previous
            : { width, height },
        );
      }}
      style={StyleSheet.absoluteFill}
    />
  );
}
