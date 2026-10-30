import { Notice } from "./PublicFrame";

/** Shown when sign-in was reached from /activate: a device is waiting. */
export function DeviceWaitingNotice({ code }: { code: string }) {
  return (
    <Notice tone="accent" icon="laptop">
      <p className="font-medium text-ink-1">A device is waiting to sign in</p>
      <p className="mt-0.5 text-ink-2">
        {code ? (
          <>
            Sign in to connect the device showing{" "}
            <span className="font-mono font-medium whitespace-nowrap text-ink-1 tabular-nums">
              {code}
            </span>
            .
          </>
        ) : (
          "Sign in, then enter the code shown on your device."
        )}
      </p>
    </Notice>
  );
}
