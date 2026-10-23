import { Icon } from "@/components/ui/icon";

/** Shown when sign-in was reached from /activate: a device is waiting. */
export function DeviceWaitingNotice({ code }: { code: string }) {
  return (
    <div className="flex items-start gap-3 rounded-lg bg-rm-accent-tint px-3 py-2.5">
      <Icon
        name="laptop"
        size="md"
        className="mt-px shrink-0 text-rm-accent-ink"
      />
      <div className="min-w-0">
        <p className="text-ui-sm font-medium text-rm-text">
          A device is waiting to sign in
        </p>
        <p className="mt-0.5 text-pretty text-ui-sm text-rm-text-secondary">
          {code ? (
            <>
              Sign in to connect the device showing{" "}
              <span className="font-mono font-medium whitespace-nowrap text-rm-text tabular-nums">
                {code}
              </span>
              .
            </>
          ) : (
            "Sign in, then enter the code shown on your device."
          )}
        </p>
      </div>
    </div>
  );
}
