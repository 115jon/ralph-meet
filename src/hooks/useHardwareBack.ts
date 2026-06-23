import { useEffect, useRef } from "react";

let statesToPop = 0;
let popTimeout: ReturnType<typeof setTimeout> | null = null;

function popHistory() {
  if (statesToPop > 0) {
    window.history.go(-statesToPop);
    statesToPop = 0;
  }
}

/**
 * A hook that enables the hardware/browser back button to close modals or go back in UI layers.
 * 
 * @param isActive Whether the layer is currently active (e.g. modal is open)
 * @param onBack Function to call when the back button is pressed
 */
export function useHardwareBack(isActive: boolean, onBack: () => void) {
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  const isPushedRef = useRef(false);

  useEffect(() => {
    if (!isActive) return;

    // Push state when activated
    window.history.pushState({ hardwareBack: true }, "");
    isPushedRef.current = true;

    const handlePopState = () => {
      if (isPushedRef.current) {
        isPushedRef.current = false; // Popped by user action
        onBackRef.current();
      }
    };

    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
      
      // If the component unmounts or isActive becomes false but the user didn't press back,
      // we need to remove the state we pushed to keep history clean.
      if (isPushedRef.current) {
        isPushedRef.current = false;
        statesToPop++;
        
        if (popTimeout) clearTimeout(popTimeout);
        popTimeout = setTimeout(popHistory, 10);
      }
    };
  }, [isActive]);
}
