/**
 * Shared primitive UI components used by all SDK components.
 * Each renders a single HTML element with `data-ra-element` attributes
 * so they are fully targetable by the appearance API and external CSS.
 */

import React, { type CSSProperties, type ReactNode } from "react";
import { useKovaAuth } from "../context";
import type { AppearanceElements } from "../types";

const visuallyHiddenStyle: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap",
  border: 0,
};

// ── Spinner ────────────────────────────────────────────────────────────────────

export function Spinner({ size = 14, style }: { size?: number; style?: CSSProperties }) {
  return (
    <output
      data-ra-element="spinner"
      style={{ width: size, height: size, borderWidth: size / 7, ...style }}
      aria-label="Loading"
      aria-live="polite"
    />
  );
}

// ── Skeleton ───────────────────────────────────────────────────────────────────

export function Skeleton({
  width,
  height,
  style,
}: {
  width?: number | string;
  height?: number | string;
  style?: CSSProperties;
}) {
  return (
    <div
      data-ra-element="skeleton"
      style={{ width, height: height ?? 16, ...style }}
    />
  );
}

// ── Alert ─────────────────────────────────────────────────────────────────────

export function Alert({
  variant,
  children,
  style,
}: {
  variant: "error" | "success" | "info";
  children: ReactNode;
  style?: CSSProperties;
}) {
  if (!children) return null;
  return (
    <div
      data-ra-element="alertBanner"
      data-variant={variant}
      role={variant === "error" ? "alert" : "status"}
      style={style}
    >
      {children}
    </div>
  );
}

// ── RateLimitBanner ────────────────────────────────────────────────────────────
//
// Shown when a 429 Too Many Requests response is received.
// Displays:
//   • An error-toned banner with a lock icon
//   • A live countdown: "Try again in Xs"
//   • An animated progress bar that depletes as the cooldown expires
//
// Props:
//   secondsRemaining — current tick from `useRateLimit().secondsRemaining`
//   totalSeconds     — the original Retry-After value; used to compute bar %
//
// Renders nothing when secondsRemaining ≤ 0.

export function RateLimitBanner({
  secondsRemaining,
  totalSeconds,
}: {
  secondsRemaining: number;
  totalSeconds: number;
}) {
  if (secondsRemaining <= 0) return null;

  const safeTotal = Math.max(1, totalSeconds);
  const progress = Math.min(1, secondsRemaining / safeTotal); // 1 → 0 (full → empty)

  const message =
    secondsRemaining === 1
      ? "Too many attempts. Try again in 1 second."
      : `Too many attempts. Try again in ${secondsRemaining}s.`;

  return (
    <div
      data-ra-element="rateLimitBanner"
      role="alert"
      aria-live="polite"
      aria-atomic="true"
      style={{
        borderRadius: "var(--ra-border-radius-sm)",
        border: "1px solid color-mix(in srgb, var(--ra-color-error) 40%, transparent)",
        background: "color-mix(in srgb, var(--ra-color-error) 10%, var(--ra-color-surface))",
        padding: "10px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        margin: "4px 0",
      }}
    >
      {/* Message row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        {/* Lock icon */}
        <svg
          role="img"
          aria-hidden="true"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--ra-color-error)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ flexShrink: 0 }}
        >
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>

        <span
          style={{
            fontSize: "0.8rem",
            color: "var(--ra-color-error)",
            fontFamily: "var(--ra-font-family)",
            fontWeight: 500,
            lineHeight: 1.3,
          }}
        >
          {message}
        </span>
      </div>

      {/* Progress bar */}
      <div
        aria-hidden="true"
        style={{
          height: 3,
          borderRadius: 2,
          background: "color-mix(in srgb, var(--ra-color-error) 20%, var(--ra-color-border))",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${progress * 100}%`,
            background: "var(--ra-color-error)",
            borderRadius: 2,
            transition: "width 0.2s linear",
          }}
        />
        <progress
          value={secondsRemaining}
          max={safeTotal}
          aria-label={`Rate limit countdown: ${secondsRemaining} seconds remaining`}
          style={visuallyHiddenStyle}
        />
      </div>
    </div>
  );
}

// ── Divider ────────────────────────────────────────────────────────────────────

export function Divider({
  label = "or",
  elements,
}: {
  label?: string;
  elements?: AppearanceElements;
}) {
  return (
    <div data-ra-element="dividerRow" style={elements?.dividerRow}>
      <div data-ra-element="dividerLine" style={elements?.dividerLine} />
      <span data-ra-element="dividerText" style={elements?.dividerText}>
        {label}
      </span>
      <div data-ra-element="dividerLine" style={elements?.dividerLine} />
    </div>
  );
}

// ── FormField ─────────────────────────────────────────────────────────────────

interface FormFieldProps {
  id: string;
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  autoComplete?: string;
  error?: string | null;
  disabled?: boolean;
  elements?: AppearanceElements;
}

export function FormField({
  id,
  label,
  type = "text",
  value,
  onChange,
  placeholder,
  required,
  autoComplete,
  error,
  disabled,
  elements,
}: FormFieldProps) {
  return (
    <div data-ra-element="formField" style={elements?.formField}>
      <label
        htmlFor={id}
        data-ra-element="formFieldLabel"
        style={elements?.formFieldLabel}
      >
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        autoComplete={autoComplete}
        disabled={disabled}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : undefined}
        data-ra-element="formFieldInput"
        style={{
          ...(error ? { borderColor: "var(--ra-color-error)" } : {}),
          ...elements?.formFieldInput,
        }}
      />
      {error && (
        <span
          id={`${id}-error`}
          data-ra-element="formFieldError"
          style={elements?.formFieldError}
          role="alert"
        >
          {error}
        </span>
      )}
    </div>
  );
}

// ── SubmitButton ───────────────────────────────────────────────────────────────

export function SubmitButton({
  isLoading,
  children,
  disabled,
  elements,
  style,
}: {
  isLoading?: boolean;
  children: ReactNode;
  disabled?: boolean;
  elements?: AppearanceElements;
  style?: CSSProperties;
}) {
  return (
    <button
      type="submit"
      disabled={disabled ?? isLoading}
      data-ra-element="formSubmitButton"
      style={{ ...elements?.formSubmitButton, ...style }}
    >
      {isLoading ? (
        <>
          <Spinner size={13} style={{ borderTopColor: "#fff" }} />
          Loading…
        </>
      ) : (
        children
      )}
    </button>
  );
}

// ── Avatar ─────────────────────────────────────────────────────────────────────

export function Avatar({
  src,
  name,
  size = 32,
  style,
}: {
  src?: string | null;
  name?: string | null;
  size?: number;
  style?: CSSProperties;
}) {
  const [imgError, setImgError] = React.useState(false);

  const initials = name
    ? name
      .trim()
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("")
    : "?";

  const base: CSSProperties = {
    width: size,
    height: size,
    borderRadius: "50%",
    flexShrink: 0,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    fontFamily: "var(--ra-font-mono)",
    fontWeight: 700,
    fontSize: size * 0.38,
    ...style,
  };

  if (src && !imgError) {
    return (
      <span style={base}>
        <img
          src={src}
          alt={name ?? "Avatar"}
          width={size}
          height={size}
          style={{ width: size, height: size, objectFit: "cover", borderRadius: "50%" }}
          onError={() => setImgError(true)}
          referrerPolicy="no-referrer"
        />
      </span>
    );
  }

  return (
    <span
      style={{
        ...base,
        background: "var(--ra-color-primary)",
        color: "#fff",
      }}
    >
      {initials}
    </span>
  );
}

// ── Branding badge ────────────────────────────────────────────────────────────
// Shown in card footer unless the app has a paid plan with hide_branding = true.

function KovaAuthBranding() {
  const { serverAppearance } = useKovaAuth();
  if (serverAppearance?.hideBranding) return null;
  return (
    <a
      href="https://auth.115jon.site"
      target="_blank"
      rel="noopener noreferrer"
      data-ra-element="brandingBadge"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontFamily: "var(--ra-font-mono)",
        fontSize: "0.75rem",
        color: "var(--ra-color-text-tertiary)",
        textDecoration: "none",
        opacity: 0.75,
        transition: "opacity 0.15s",
        marginTop: 8,
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = "1"; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = "0.75"; }}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="10" fill="var(--ra-color-primary)" opacity="0.9" />
        <path d="M8 16V8h5a3 3 0 0 1 0 6H8" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
      </svg>
      Secured by kova-auth
    </a>
  );
}

// ── Development-mode badge ─────────────────────────────────────────────────────
// Shown at the bottom of every sign-in/sign-up card for pk_dev_/pk_test_ apps.

function DevModeBadge() {
  const { mode } = useKovaAuth();
  if (mode !== "test") return null;
  return (
    <div
      data-ra-element="devModeBadge"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        padding: "6px 0 0",
        borderTop: "1px dashed color-mix(in srgb, var(--ra-color-border-strong) 60%, transparent)",
        marginTop: 10,
        width: "100%",
      }}
    >
      <span style={{
        width: 6, height: 6, borderRadius: "50%",
        background: "#f59e0b",
        flexShrink: 0,
        boxShadow: "0 0 5px #f59e0b88",
      }} />
      <span style={{
        fontFamily: "var(--ra-font-mono)",
        fontSize: "0.75rem",
        color: "#f59e0b",
        letterSpacing: "0.04em",
        fontWeight: 600,
      }}>DEVELOPMENT INSTANCE</span>
    </div>
  );
}

// ── Card shell ────────────────────────────────────────────────────────────────

export function Card({
  children,
  elements,
  style,
  className,
}: {
  children: ReactNode;
  elements?: AppearanceElements;
  style?: CSSProperties;
  className?: string;
}) {
  return (
    <div
      data-ra-element="card"
      data-ra-root
      style={{ ...elements?.card, ...style }}
      className={className}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  subtitle,
  elements,
}: {
  title: string;
  subtitle?: string;
  elements?: AppearanceElements;
}) {
  const { serverAppearance } = useKovaAuth();
  const logoUrl = serverAppearance?.logoUrl;
  const logoAlt = `${serverAppearance?.displayName ?? "Application"} logo`;

  return (
    <div data-ra-element="cardHeader" style={elements?.cardHeader}>
      {logoUrl && (
        <img
          src={logoUrl}
          alt={logoAlt}
          data-ra-element="appLogo"
          style={elements?.appLogo}
        />
      )}
      <h1 data-ra-element="cardTitle" style={elements?.cardTitle}>
        {title}
      </h1>
      {subtitle && (
        <p data-ra-element="cardSubtitle" style={elements?.cardSubtitle}>
          {subtitle}
        </p>
      )}
    </div>
  );
}

export function CardBody({
  children,
  elements,
}: {
  children: ReactNode;
  elements?: AppearanceElements;
}) {
  return (
    <div data-ra-element="cardBody" style={elements?.cardBody}>
      {children}
    </div>
  );
}

export function CardFooter({
  children,
  elements,
}: {
  children: ReactNode;
  elements?: AppearanceElements;
}) {
  return (
    <div data-ra-element="cardFooter" style={elements?.cardFooter}>
      {children}
      {/* Branding + dev badge injected at the bottom of every footer */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
        <KovaAuthBranding />
        <DevModeBadge />
      </div>
    </div>
  );
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

export function Tabs({
  tabs,
  active,
  onSelect,
  elements,
}: {
  tabs: Array<{ id: string; label: string }>;
  active: string;
  onSelect: (id: string) => void;
  elements?: AppearanceElements;
}) {
  return (
    <div
      role="tablist"
      data-ra-element="tabsRoot"
      style={elements?.tabsRoot}
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          type="button"
          aria-selected={active === tab.id}
          onClick={() => onSelect(tab.id)}
          data-ra-element="tab"
          style={
            active === tab.id
              ? { ...elements?.tab, ...elements?.tabActive }
              : elements?.tab
          }
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
