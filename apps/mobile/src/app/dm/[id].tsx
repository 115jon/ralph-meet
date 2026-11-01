import { useLocalSearchParams } from "expo-router";
import { useEffect } from "react";

import { handOverToHome } from "@/features/conversation/navigation";

/** A link or push to a direct message (and maybe one message in it). */
export default function DmLink() {
  const { id, message } = useLocalSearchParams<{
    id: string;
    message?: string;
  }>();
  useEffect(() => {
    handOverToHome({ kind: "dm", id }, message);
  }, [id, message]);
  return null;
}
