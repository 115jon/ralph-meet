import { requireOptionalNativeModule } from "expo";

/**
 * True when the installed build links the native module `name`. Features
 * on a module added after the dev client was built check this and step
 * aside instead of crashing the bundle at import.
 */
export function hasNativeModule(name: string): boolean {
  return requireOptionalNativeModule(name) !== null;
}
