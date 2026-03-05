/**
 * No-op shim for desktop-only Tauri plugins on mobile.
 *
 * Desktop plugins like autostart, updater, and window-state don't exist
 * on mobile. This shim provides empty exports so imports don't break
 * at bundle time.
 */

// Common no-op function that does nothing
const noop = (..._args: any[]): any => { };

// Common no-op async function
const noopAsync = (..._args: any[]): Promise<any> => Promise.resolve();

// Export everything as no-ops
export default noop;
export {
  noopAsync as check, noop as disable, noop as enable, noopAsync as install, noop as isEnabled, noop as relaunch
};

