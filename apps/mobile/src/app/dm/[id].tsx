import { useLocalSearchParams } from "expo-router";
import { useEffect } from "react";

import { handOverToHome } from "@/features/conversation/navigation";

/** A link or push to a direct message: handed to home's pager. */
export default function DmLink() {
  const { id } = useLocalSearchParams<{ id: string }>();
  useEffect(() => {
    handOverToHome({ kind: "dm", id });
  }, [id]);
  return null;
}
