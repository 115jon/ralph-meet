/**
 * CSS custom-property injection.
 *
 * Writes a `<style id="ra-vars">` tag into `<head>` that maps
 * AppearanceVariables to CSS custom properties on `:root`.
 * Components reference these via `var(--ra-*)`. This keeps all
 * styling zero-dependency while still being fully overridable.
 */

import type { AppearanceVariables } from "../types";

// Stable map between appearance keys and CSS property names
const VAR_MAP: Record<keyof AppearanceVariables, string> = {
  colorPrimary: "--ra-color-primary",
  colorPrimaryHover: "--ra-color-primary-hover",
  colorBackground: "--ra-color-bg",
  colorSurface: "--ra-color-surface",
  colorSurfaceRaised: "--ra-color-surface-raised",
  colorText: "--ra-color-text",
  colorTextSecondary: "--ra-color-text-secondary",
  colorTextTertiary: "--ra-color-text-tertiary",
  colorBorder: "--ra-color-border",
  colorBorderStrong: "--ra-color-border-strong",
  colorError: "--ra-color-error",
  colorSuccess: "--ra-color-success",
  borderRadius: "--ra-radius",
  borderRadiusSm: "--ra-radius-sm",
  fontFamily: "--ra-font",
  fontFamilyMono: "--ra-font-mono",
  fontSize: "--ra-font-size",
};

/**
 * Injects (or replaces) a `<style>` tag with CSS custom properties
 * derived from the appearance variables map.
 *
 * @param vars   Merged appearance variables.
 * @param prevId ID attribute of the previous style tag (to remove it).
 * @returns      The ID of the newly injected style tag.
 */
export function injectAppearanceVars(
  vars: Required<AppearanceVariables>,
  prevId: string | null
): string {
  if (typeof document === "undefined") return "ra-vars"; // SSR guard

  // Remove previous injection to avoid stacking duplicate rules
  if (prevId) {
    document.getElementById(prevId)?.remove();
  }

  const id = "ra-vars";

  const declarations = (
    Object.entries(vars) as Array<[keyof AppearanceVariables, string]>
  )
    .map(([key, value]) => `  ${VAR_MAP[key]}: ${value};`)
    .join("\n");

  // We also inject the SDK's base structural styles here the first time.
  // They use only var(--ra-*) tokens — never hardcoded colours.
  const css = `
:root {
${declarations}
}

/* ── @kova/react base styles ─────────────────────────────────── */
[data-ra-root] {
  font-family: var(--ra-font);
  font-size: var(--ra-font-size);
  color: var(--ra-color-text);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  box-sizing: border-box;
}
[data-ra-root] *, [data-ra-root] *::before, [data-ra-root] *::after {
  box-sizing: inherit;
}

/* Card */
[data-ra-element="card"] {
  background: var(--ra-color-surface);
  border: 1px solid var(--ra-color-border);
  border-radius: var(--ra-radius);
  overflow: hidden;
  width: 100%;
  max-width: 420px;
  margin: 0 auto;
  box-shadow: 0 24px 48px rgba(0,0,0,0.45);
}

/* Card sections */
[data-ra-element="cardHeader"] {
  padding: 28px 28px 0;
}
[data-ra-element="appLogo"] {
  width: 38px;
  height: 38px;
  object-fit: contain;
  border-radius: var(--ra-radius-sm);
  display: block;
  margin: 0 0 16px;
}
[data-ra-element="cardBody"] {
  padding: 24px 28px;
}
[data-ra-element="cardFooter"] {
  padding: 0 28px 20px;
  text-align: center;
}

/* Card title */
[data-ra-element="cardTitle"] {
  font-family: var(--ra-font-mono);
  font-size: 1.05rem;
  font-weight: 700;
  letter-spacing: -0.025em;
  color: var(--ra-color-text);
  margin: 0 0 6px;
}

/* Card subtitle */
[data-ra-element="cardSubtitle"] {
  font-size: 0.82rem;
  color: var(--ra-color-text-secondary);
  margin: 0 0 20px;
  line-height: 1.6;
}

/* Tabs */
[data-ra-element="tabsRoot"] {
  display: flex;
  gap: 2px;
  border-bottom: 1px solid var(--ra-color-border);
  margin-bottom: 20px;
}
[data-ra-element="tab"] {
  flex: 1;
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  padding: 9px 12px;
  cursor: pointer;
  font-family: var(--ra-font-mono);
  font-size: 0.78rem;
  font-weight: 500;
  color: var(--ra-color-text-tertiary);
  letter-spacing: -0.01em;
  transition: color 0.15s, border-color 0.15s;
  white-space: nowrap;
}
[data-ra-element="tab"]:hover {
  color: var(--ra-color-text-secondary);
}
[data-ra-element="tab"][aria-selected="true"] {
  color: var(--ra-color-primary);
  border-bottom-color: var(--ra-color-primary);
}

/* Form fields */
[data-ra-element="formField"] {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 14px;
}
[data-ra-element="formFieldLabel"] {
  font-family: var(--ra-font-mono);
  font-size: 0.74rem;
  font-weight: 500;
  color: var(--ra-color-text-secondary);
  letter-spacing: -0.01em;
}
[data-ra-element="formFieldInput"] {
  width: 100%;
  background: var(--ra-color-surface-raised);
  border: 1px solid var(--ra-color-border);
  border-radius: var(--ra-radius-sm);
  padding: 9px 12px;
  font-family: var(--ra-font-mono);
  font-size: 0.84rem;
  color: var(--ra-color-text);
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}
[data-ra-element="formFieldInput"]:focus {
  border-color: var(--ra-color-primary);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--ra-color-primary) 15%, transparent);
}
[data-ra-element="formFieldInput"]::placeholder {
  color: var(--ra-color-text-tertiary);
}
[data-ra-element="formFieldError"] {
  font-size: 0.75rem;
  color: var(--ra-color-error);
  display: flex;
  align-items: center;
  gap: 5px;
}

/* Submit button */
[data-ra-element="formSubmitButton"] {
  width: 100%;
  background: var(--ra-color-primary);
  color: #fff;
  border: none;
  border-radius: var(--ra-radius-sm);
  padding: 10px 16px;
  font-family: var(--ra-font-mono);
  font-size: 0.84rem;
  font-weight: 600;
  cursor: pointer;
  letter-spacing: -0.01em;
  transition: background 0.15s, opacity 0.15s, transform 0.1s;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-top: 4px;
}
[data-ra-element="formSubmitButton"]:hover:not(:disabled) {
  background: var(--ra-color-primary-hover);
}
[data-ra-element="formSubmitButton"]:active:not(:disabled) {
  transform: scale(0.99);
}
[data-ra-element="formSubmitButton"]:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

/* Social buttons */
[data-ra-element="socialButtonsRoot"] {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 18px;
}
[data-ra-element="socialButton"] {
  width: 100%;
  background: var(--ra-color-surface-raised);
  border: 1px solid var(--ra-color-border);
  border-radius: var(--ra-radius-sm);
  padding: 9px 14px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 10px;
  font-family: var(--ra-font-mono);
  font-size: 0.82rem;
  font-weight: 500;
  color: var(--ra-color-text);
  transition: background 0.12s, border-color 0.12s;
}
[data-ra-element="socialButton"]:hover:not(:disabled) {
  background: var(--ra-color-surface);
  border-color: var(--ra-color-border-strong);
}

/* Divider */
[data-ra-element="dividerRow"] {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 16px 0;
}
[data-ra-element="dividerLine"] {
  flex: 1;
  height: 1px;
  background: var(--ra-color-border);
}
[data-ra-element="dividerText"] {
  font-family: var(--ra-font-mono);
  font-size: 0.68rem;
  color: var(--ra-color-text-tertiary);
  white-space: nowrap;
  user-select: none;
}

/* Footer link */
[data-ra-element="cardFooter"] a,
[data-ra-element="cardFooter"] button {
  font-size: 0.78rem;
  color: var(--ra-color-text-secondary);
  background: none;
  border: none;
  cursor: pointer;
  text-decoration: none;
  transition: color 0.12s;
  font-family: var(--ra-font-mono);
}
[data-ra-element="cardFooter"] a:hover,
[data-ra-element="cardFooter"] button:hover {
  color: var(--ra-color-primary);
}

/* Alert banner */
[data-ra-element="alertBanner"] {
  border-radius: var(--ra-radius-sm);
  padding: 10px 12px;
  font-size: 0.78rem;
  line-height: 1.55;
  margin-bottom: 14px;
  display: flex;
  align-items: flex-start;
  gap: 8px;
}
[data-ra-element="alertBanner"][data-variant="error"] {
  background: rgba(248,113,113,0.08);
  border: 1px solid rgba(248,113,113,0.18);
  color: var(--ra-color-error);
}
[data-ra-element="alertBanner"][data-variant="success"] {
  background: rgba(74,222,128,0.08);
  border: 1px solid rgba(74,222,128,0.18);
  color: var(--ra-color-success);
}
[data-ra-element="alertBanner"][data-variant="info"] {
  background: color-mix(in srgb, var(--ra-color-primary) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--ra-color-primary) 18%, transparent);
  color: var(--ra-color-primary);
}

/* UserButton */
[data-ra-element="userButtonTrigger"] {
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--ra-radius-sm);
  padding: 4px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  transition: background 0.12s, border-color 0.12s;
}
[data-ra-element="userButtonTrigger"]:hover {
  background: rgba(255,255,255,0.05);
  border-color: var(--ra-color-border);
}
[data-ra-element="userButtonMenu"] {
  position: absolute;
  z-index: 9999;
  min-width: 220px;
  background: var(--ra-color-surface);
  border: 1px solid var(--ra-color-border-strong);
  border-radius: var(--ra-radius-sm);
  box-shadow: 0 16px 48px rgba(0,0,0,0.6);
  padding: 4px;
  overflow: hidden;
}
[data-ra-element="userButtonMenuItem"] {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 8px 10px;
  background: transparent;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-family: var(--ra-font-mono);
  font-size: 0.78rem;
  color: var(--ra-color-text-secondary);
  transition: background 0.1s, color 0.1s;
  text-align: left;
}
[data-ra-element="userButtonMenuItem"]:hover {
  background: rgba(255,255,255,0.04);
  color: var(--ra-color-text);
}
[data-ra-element="userButtonMenuItem"][data-destructive="true"]:hover {
  background: rgba(248,113,113,0.08);
  color: var(--ra-color-error);
}

/* Spinner */
@keyframes ra-spin { to { transform: rotate(360deg); } }
[data-ra-element="spinner"] {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255,255,255,0.25);
  border-top-color: currentColor;
  border-radius: 50%;
  animation: ra-spin 0.7s linear infinite;
  flex-shrink: 0;
}

/* Skeleton shimmer */
@keyframes ra-shimmer {
  0%   { background-position: -400px 0; }
  100% { background-position: 400px 0; }
}
[data-ra-element="skeleton"] {
  border-radius: var(--ra-radius-sm);
  background: linear-gradient(
    90deg,
    var(--ra-color-surface-raised) 25%,
    rgba(255,255,255,0.04) 50%,
    var(--ra-color-surface-raised) 75%
  );
  background-size: 800px 100%;
  animation: ra-shimmer 1.4s ease-in-out infinite;
}
`.trim();

  const el = document.createElement("style");
  el.id = id;
  el.textContent = css;
  document.head.appendChild(el);

  return id;
}
