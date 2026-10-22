export function isSelectLayerTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    !!target.closest('[data-slot="select-content"]')
  );
}

export function isSelectContentOpen(): boolean {
  return !!document.querySelector(
    '[data-slot="select-content"][data-state="open"]',
  );
}

export function shouldIgnoreSelectDismiss(target: EventTarget | null): boolean {
  return isSelectLayerTarget(target) || isSelectContentOpen();
}
