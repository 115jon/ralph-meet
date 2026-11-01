import { Redirect } from "expo-router";

import { useSession } from "@/features/auth/session";

// Sits outside the Stack.Protected guards, so it must pick the side itself;
// a fixed /servers bounced signed-out users back here in a loop.
export default function Index() {
  const signedIn = useSession((s) => s.status === "signed-in");
  return <Redirect href={signedIn ? "/servers" : "/sign-in"} />;
}
