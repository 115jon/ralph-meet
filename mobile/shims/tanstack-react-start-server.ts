/**
 * Shim for `@tanstack/react-start/server` in the desktop SPA build.
 */
export function getRequestHeader(_name: string): string | undefined {
  return undefined;
}

export function getResponseHeader(_name: string): string | undefined {
  return undefined;
}

export function setResponseHeader(_name: string, _value: string): void { }

export function getWebRequest(): Request | undefined {
  return undefined;
}

export function setResponseStatus(_status: number): void { }
