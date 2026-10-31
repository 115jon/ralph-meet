// The realtime socket lifecycle lives in @ralph/realtime (shared with
// apps/mobile). The web app logs through its coloured console logger, and
// keeps the DOM wake source in ./page-wake.
import { setRealtimeLogger } from "@ralph/realtime";

import { clog } from "@/lib/console-logger";

setRealtimeLogger(clog);

export * from "@ralph/realtime";
