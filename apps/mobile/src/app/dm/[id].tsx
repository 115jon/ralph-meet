import { useLocalSearchParams } from "expo-router";
import { useEffect } from "react";

import { requestCallBack } from "@/features/calls/actions";
import { handOverToHome } from "@/features/conversation/navigation";

/**
 * A link or push to a direct message (and maybe one message in it); a
 * missed call's "Call back" adds `call=1`, which asks to ring them.
 */
export default function DmLink() {
  const { id, message, call } = useLocalSearchParams<{
    id: string;
    message?: string;
    call?: string;
  }>();
  useEffect(() => {
    handOverToHome({ kind: "dm", id }, message);
    if (call === "1") requestCallBack(id);
  }, [id, message, call]);
  return null;
}
