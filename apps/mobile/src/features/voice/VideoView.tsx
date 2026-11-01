import { StyleSheet } from "react-native";
import { RTCView } from "react-native-webrtc";

interface VideoViewProps {
  streamURL: string;
  /** contain for screens (nothing cropped), cover for cameras. */
  fit: "contain" | "cover";
  /** Only our own front camera; remote video always shows as sent. */
  mirror?: boolean;
}

/**
 * A video filling its tile. Loaded with React.lazy from the tiles, so
 * react-native-webrtc stays out of the app until a call has video.
 */
export default function VideoView({
  streamURL,
  fit,
  mirror = false,
}: VideoViewProps) {
  return (
    <RTCView
      streamURL={streamURL}
      objectFit={fit}
      mirror={mirror}
      style={StyleSheet.absoluteFill}
    />
  );
}
