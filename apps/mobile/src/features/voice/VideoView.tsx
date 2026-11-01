import { StyleSheet } from "react-native";
import { RTCView } from "react-native-webrtc";

interface VideoViewProps {
  streamURL: string;
  /** contain for screens (nothing cropped), cover for cameras. */
  fit: "contain" | "cover";
}

/**
 * A remote video filling its tile. Loaded with React.lazy from the tiles, so
 * react-native-webrtc stays out of the app until a call has video. Remote
 * video is never mirrored.
 */
export default function VideoView({ streamURL, fit }: VideoViewProps) {
  return (
    <RTCView
      streamURL={streamURL}
      objectFit={fit}
      mirror={false}
      style={StyleSheet.absoluteFill}
    />
  );
}
