import { useEffect, useState } from "react";

/**
 * A hook that delays the unmounting of a component to allow for exit animations.
 * @param isMounted Whether the component should currently be mounted
 * @param delayTime The duration of the exit animation in milliseconds
 * @returns A boolean indicating if the component should still be rendered in the DOM
 */
export function useDelayUnmount(isMounted: boolean, delayTime: number) {
  const [shouldRender, setShouldRender] = useState(false);

  useEffect(() => {
    let timeoutId: NodeJS.Timeout;

    if (isMounted && !shouldRender) {
      setShouldRender(true);
    } else if (!isMounted && shouldRender) {
      timeoutId = setTimeout(() => setShouldRender(false), delayTime);
    }

    return () => clearTimeout(timeoutId);
  }, [isMounted, delayTime, shouldRender]);

  return shouldRender;
}

/**
 * Retains the last non-null value while a component stays mounted for its exit
 * animation, preventing closing-state renders from losing required props.
 */
export function useDelayedUnmountValue<T>(
  value: T | null | undefined,
  delayTime: number,
  isMounted: boolean = value != null,
) {
  const shouldRender = useDelayUnmount(isMounted, delayTime);
  const [retainedValue, setRetainedValue] = useState<T | null>(value ?? null);

  useEffect(() => {
    if (value != null) {
      setRetainedValue(value);
      return;
    }

    if (!shouldRender) {
      setRetainedValue(null);
    }
  }, [shouldRender, value]);

  return {
    shouldRender,
    value: value ?? retainedValue,
  };
}
