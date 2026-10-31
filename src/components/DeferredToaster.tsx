import { whenIdle } from "@/lib/idle";
import {
  isChatStoreLoaded,
  subscribeChatStoreLoaded,
} from "@/stores/chat-store-loaded";
import {
  lazy,
  Suspense,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";

// Sonner and the toast card are about 45 KB raw that no public page shows
// before someone does something, so the root mounts the Toaster after first
// paint instead of in the entry. The chat store loading counts as "now":
// that is the signed-in app, which raises toasts as soon as it runs.
const Toaster = lazy(() =>
  import("@/components/ui/toast").then((mod) => ({ default: mod.Toaster })),
);

export function DeferredToaster() {
  const [idle, setIdle] = useState(false);
  const chatStoreLoaded = useSyncExternalStore(
    subscribeChatStoreLoaded,
    isChatStoreLoaded,
    () => false,
  );

  useEffect(() => whenIdle(() => setIdle(true)), []);

  if (!idle && !chatStoreLoaded) return null;
  return (
    <Suspense fallback={null}>
      <Toaster />
    </Suspense>
  );
}
