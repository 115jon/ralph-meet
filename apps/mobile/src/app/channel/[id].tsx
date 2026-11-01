import { useLocalSearchParams } from "expo-router";
import { useEffect } from "react";

import { handOverToHome } from "@/features/conversation/navigation";

/**
 * A link or push to a server text channel. Home's pager owns the open
 * conversation, so this only hands it over and steps aside.
 */
export default function ChannelLink() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  useEffect(() => {
    handOverToHome({ kind: "channel", id, name });
  }, [id, name]);
  return null;
}
