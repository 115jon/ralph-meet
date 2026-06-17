import * as react_jsx_runtime from 'react/jsx-runtime';
import React, { ReactNode } from 'react';
import * as better_auth_client from 'better-auth/client';
import { BetterAuthClientPlugin } from 'better-auth/client';
import * as better_auth from 'better-auth';

/**
 * @kova/react — shared TypeScript types
 *
 * All public-facing interfaces live here so they can be imported
 * without pulling in any React dependencies.
 */
/**
 * Design tokens that cascade as CSS custom properties onto every SDK component.
 * Any value not specified falls back to a sensible dark-mode default.
 */
interface AppearanceVariables {
    /** Primary accent color (buttons, active states). @default "#3b82f6" */
    colorPrimary?: string;
    /** Hover tone of primary. @default "#2563eb" */
    colorPrimaryHover?: string;
    /** Background behind the card. @default "#0a0a0a" */
    colorBackground?: string;
    /** Card / surface background. @default "#111111" */
    colorSurface?: string;
    /** Subtle raised surface (inputs, keylines). @default "#1a1a1a" */
    colorSurfaceRaised?: string;
    /** Primary text. @default "#f5f5f5" */
    colorText?: string;
    /** Secondary / label text. @default "#a0a0a0" */
    colorTextSecondary?: string;
    /** Placeholder / disabled text. @default "#606060" */
    colorTextTertiary?: string;
    /** Default border color. @default "#2a2a2a" */
    colorBorder?: string;
    /** Strong border (focused inputs, open dropdowns). @default "#3a3a3a" */
    colorBorderStrong?: string;
    /** Error / destructive color. @default "#f87171" */
    colorError?: string;
    /** Success color. @default "#4ade80" */
    colorSuccess?: string;
    /** Border radius for cards. @default "8px" */
    borderRadius?: string;
    /** Border radius for inputs and buttons. @default "5px" */
    borderRadiusSm?: string;
    /** Body font family. @default "Inter, system-ui, sans-serif" */
    fontFamily?: string;
    /** Monospace font family. @default "'JetBrains Mono', 'Fira Code', monospace" */
    fontFamilyMono?: string;
    /** Base font size. @default "14px" */
    fontSize?: string;
}
/**
 * Per-element style overrides.
 * Keys match the `data-ra-element` attribute of each rendered node.
 */
interface AppearanceElements {
    card?: React.CSSProperties;
    cardHeader?: React.CSSProperties;
    appLogo?: React.CSSProperties;
    cardTitle?: React.CSSProperties;
    cardSubtitle?: React.CSSProperties;
    cardBody?: React.CSSProperties;
    cardFooter?: React.CSSProperties;
    formField?: React.CSSProperties;
    formFieldLabel?: React.CSSProperties;
    formFieldInput?: React.CSSProperties;
    formFieldError?: React.CSSProperties;
    formSubmitButton?: React.CSSProperties;
    /** Container for the 429 rate-limit feedback banner. */
    rateLimitBanner?: React.CSSProperties;
    socialButtonsRoot?: React.CSSProperties;
    socialButton?: React.CSSProperties;
    dividerRow?: React.CSSProperties;
    dividerLine?: React.CSSProperties;
    dividerText?: React.CSSProperties;
    tabsRoot?: React.CSSProperties;
    tab?: React.CSSProperties;
    tabActive?: React.CSSProperties;
    userButtonTrigger?: React.CSSProperties;
    userButtonAvatar?: React.CSSProperties;
    userButtonMenu?: React.CSSProperties;
    userButtonMenuItem?: React.CSSProperties;
    connectedAccountsSection?: React.CSSProperties;
    connectedAccountsItem?: React.CSSProperties;
    connectedAccountsItemLabel?: React.CSSProperties;
    connectedAccountsConnectButton?: React.CSSProperties;
    orgSwitcherTrigger?: React.CSSProperties;
    orgSwitcherMenu?: React.CSSProperties;
    orgSwitcherOrgItem?: React.CSSProperties;
}
/**
 * Top-level appearance configuration — combines design tokens with
 * per-element overrides for fully themeable components.
 *
 * @example
 * ```tsx
 * <SignIn
 *   appearance={{
 *     variables: { colorPrimary: "#7c3aed", borderRadius: "12px" },
 *     elements: { card: { boxShadow: "none" } },
 *   }}
 * />
 * ```
 */
interface Appearance {
    variables?: AppearanceVariables;
    elements?: AppearanceElements;
}
interface OAuthProvider {
    id: "google" | "discord" | "github" | "microsoft" | "apple" | "facebook" | "twitter" | string;
    label?: string;
    /** Resolved icon URL or React element, populated automatically for known providers. */
    icon?: string;
}
/** Per-plugin enable/configure flags for `createKovaAuthClient`. */
interface PluginConfig {
    /**
     * Admin client plugin — required for `user.role`, `banned`,
     * and `/api/auth/admin/*` management endpoints.
     */
    admin?: boolean;
    /**
     * API Key plugin — `personal` and `organization` key types.
     */
    apiKey?: boolean;
    /**
     * Two-factor authentication — TOTP authenticator app + email OTP.
     */
    twoFactor?: boolean | {
        /** Called when the server triggers a 2FA challenge during sign-in. */
        onTwoFactorRedirect?: () => void;
    };
    /**
     * Organization plugin — multi-tenancy with teams and dynamic RBAC.
     * Both `teams` and `dynamicAccessControl` are enabled by default
     * to match the server configuration.
     */
    organization?: boolean | {
        teams?: boolean;
        dynamicAccessControl?: boolean;
    };
    /**
     * Multi-session plugin — simultaneous sign-in with multiple accounts.
     */
    multiSession?: boolean;
    /**
     * Passkey/WebAuthn plugin — biometric + hardware key authentication.
     * Note: rpID is pinned to the auth server domain on the server side.
     */
    passkey?: boolean;
    /**
     * Magic link plugin — passwordless sign-in via email URL (10-min expiry).
     */
    magicLink?: boolean;
    /**
     * Username plugin — adds `username` field (3–32 chars, lowercase).
     */
    username?: boolean;
    /**
     * Generic OAuth / OIDC plugin — enables custom identity providers
     * (Keycloak, Auth0, Okta, any OIDC-compatible IdP).
     * Requires the `genericOAuth()` plugin to be configured on the server.
     */
    genericOAuth?: boolean;
}
interface KovaAuthConfig {
    /**
     * Publishable key from your kova-auth dashboard.
     * Format: `pk_live_<base64>` or `pk_test_<base64>`.
     * Encodes the auth server URL — no need to pass `authUrl` separately.
     */
    publishableKey?: string;
    /**
     * Auth server base URL.
     * Required when `publishableKey` is not provided.
     * @example "https://auth.115jon.site"
     */
    authUrl?: string;
    /** Plugin subset to activate (all enabled by default). */
    plugins?: PluginConfig;
    /**
     * OAuth providers to render in social buttons.
     * Defaults to `["google", "discord"]` if not set.
     */
    oauthProviders?: OAuthProvider[];
    /** Absolute or relative URL to navigate to after sign-in. */
    afterSignInUrl?: string;
    /** Absolute or relative URL to navigate to after sign-up. */
    afterSignUpUrl?: string;
    /** Absolute or relative URL to navigate to after sign-out. */
    afterSignOutUrl?: string;
    /** Controls how often the SDK re-validates the session with the server. */
    sessionOptions?: {
        /** Seconds between automatic session re-checks. @default undefined (Better Auth default) */
        refetchInterval?: number;
        /** Re-check session when the browser tab regains focus. @default true */
        refetchOnWindowFocus?: boolean;
        /** Re-check session when the device is offline. @default true */
        refetchWhenOffline?: boolean;
    };
    /**
     * Optional raw session token supplied by a host shell.
     * Native containers can persist the app-scoped bearer token outside browser
     * storage and seed the SDK with it at startup.
     */
    initialSessionToken?: string | null;
    /**
     * Called whenever the SDK stores or clears the current app-scoped bearer
     * token. Host apps can mirror the token into their own API fetch layer.
     */
    onSessionTokenChange?: (token: string | null) => void;
    /** Global appearance overrides applied to all SDK components. */
    appearance?: Appearance;
    /**
     * When true, the SDK updates the host document's favicon from application
     * appearance. Defaults to false so embedded sign-in components do not
     * override the containing site's favicon.
     */
    manageFavicon?: boolean;
}
/**
 * A provider account linked to the current user.
 * Returned by `useLinkedAccounts()` and `client.listAccounts()`.
 */
interface LinkedAccount {
    /** Better Auth account row ID. */
    id: string;
    /** Provider identifier ("google", "github", "credential", etc.). */
    providerId: string;
    /** The opaque account ID from the provider side. */
    accountId: string;
    /** ISO date string when the link was created. */
    createdAt: string;
    /** "credential" | "oauth2" | "oidc" — from the account row */
    accessToken?: string | null;
    scopes?: string[];
}
interface KovaUser {
    id: string;
    name: string;
    fullName: string | null;
    email: string;
    emailVerified: boolean;
    image: string | null;
    imageUrl?: string;
    role: string | null;
    banned: boolean;
    createdAt: Date;
    updatedAt: Date;
    username: string | null;
    twoFactorEnabled: boolean;
    primaryEmailAddress: {
        emailAddress: string;
    } | null;
    unsafeMetadata: Record<string, unknown>;
    reload?: () => Promise<void> | void;
}
interface KovaSession {
    id: string;
    token: string;
    userId: string;
    expiresAt: Date;
    ipAddress: string | null;
    userAgent: string | null;
    activeOrganizationId: string | null;
}
interface KovaOrganization {
    id: string;
    name: string;
    slug: string;
    logo: string | null;
    metadata: Record<string, unknown> | null;
    createdAt: Date;
}
interface KovaMembership {
    id: string;
    userId: string;
    organizationId: string;
    role: string;
    createdAt: Date;
}
interface UseSessionReturn {
    session: {
        user: KovaUser;
        session: KovaSession;
    } | null;
    isLoaded: boolean;
    isSignedIn: boolean;
    refetch: () => void;
}
interface UseUserReturn {
    user: KovaUser | null;
    isLoaded: boolean;
    isSignedIn: boolean;
    /** Update mutable user fields (name, username, image). */
    updateUser: (data: {
        name?: string;
        image?: string;
    }) => Promise<void>;
}
interface UseLinkedAccountsReturn {
    /** All provider accounts linked to the current user. */
    accounts: LinkedAccount[];
    /** `false` until the first fetch resolves. */
    isLoaded: boolean;
    /** True while a link or unlink operation is in-flight. */
    isUpdating: boolean;
    /** Error message from the last failed operation, or `null`. */
    error: string | null;
    /**
     * Initiate an OAuth redirect to link a new provider account.
     * Redirects the browser — resolves immediately after redirect is triggered.
     */
    linkAccount: (opts: {
        provider: string;
        callbackURL?: string;
    }) => Promise<void>;
    /**
     * Refresh the list from the server.
     */
    refetch: () => void;
}
interface UseOrganizationReturn {
    organization: KovaOrganization | null;
    membership: KovaMembership | null;
    isLoaded: boolean;
}
type SignInTab = "email" | "magic-link" | "passkey";
interface SignInProps {
    /** Override the URL the user is sent to on success. Inherits from provider. */
    afterSignInUrl?: string;
    /** Override the sign-up link href. @default "/sign-up" */
    signUpUrl?: string;
    /** Initial tab shown. @default "email" */
    defaultTab?: SignInTab;
    /** Custom appearance for this instance. Merged with provider appearance. */
    appearance?: Appearance;
    /** Additional CSS class on the root element. */
    className?: string;
}
interface SignUpProps {
    /** Override redirect after registration. Inherits from provider. */
    afterSignUpUrl?: string;
    /** Override the sign-in link href. @default "/sign-in" */
    signInUrl?: string;
    appearance?: Appearance;
    className?: string;
}
interface UserButtonProps {
    /** URL to redirect to after sign-out. Inherits from provider. */
    afterSignOutUrl?: string;
    /** Show the user's name next to the avatar. @default false */
    showName?: boolean;
    /** Avatar diameter in px. @default 32 */
    size?: number;
    appearance?: Appearance;
    className?: string;
}
interface OrgSwitcherProps {
    /** Hide the component until organizations are loaded. @default false */
    hideWhenLoading?: boolean;
    /** Hide the component when user has no org memberships. @default false */
    hideWhenNoOrgs?: boolean;
    appearance?: Appearance;
    className?: string;
}
interface ProtectProps {
    /**
     * Required auth state.
     * - `"signed-in"` (default) — user must be signed in
     * - `"signed-out"` — user must NOT be signed in (useful for auth pages)
     */
    condition?: "signed-in" | "signed-out";
    /** Required platform role (e.g. "admin"). Implies signed-in. */
    role?: string;
    /**
     * Rendered when the condition is not met.
     * Defaults to `null` (nothing is rendered).
     */
    fallback?: React.ReactNode;
    /** Shown during loading. Defaults to `null`. */
    loading?: React.ReactNode;
    children: React.ReactNode;
}

interface ClientOptions {
    /**
     * Auth server base URL (without trailing slash).
     * @example "https://auth.115jon.site"
     */
    authUrl: string;
    /**
     * The publishable key identifying this SDK consumer.
     * Automatically forwarded as `X-Publishable-Key` on every request,
     * allowing the server to resolve per-app CORS and redirect URI allowlists.
     * @example "pk_dev_abc123"
     */
    publishableKey?: string;
    /** Selectively enable / configure plugins. All are enabled by default. */
    plugins?: PluginConfig;
    /**
     * Additional fetch options forwarded to every Better Auth request.
     * `credentials: "include"` is always set.
     */
    fetchOptions?: RequestInit;
    /** Better Auth session revalidation behavior. */
    sessionOptions?: {
        refetchInterval?: number;
        refetchOnWindowFocus?: boolean;
        refetchWhenOffline?: boolean;
    };
}
/**
 * Builds the underlying Better Auth client.
 * Call once at module level and share the result via context.
 */
declare function createKovaAuthClient(opts: ClientOptions): {
    signIn: {
        social: <FetchOptions extends better_auth.ClientFetchOption<Partial<{
            provider: (string & {}) | "linear" | "huggingface" | "google" | "discord" | "github" | "microsoft" | "apple" | "facebook" | "twitter" | "atlassian" | "cognito" | "figma" | "slack" | "spotify" | "twitch" | "dropbox" | "kick" | "linkedin" | "gitlab" | "tiktok" | "reddit" | "roblox" | "salesforce" | "vk" | "zoom" | "notion" | "kakao" | "naver" | "line" | "paybin" | "paypal" | "polar" | "railway" | "vercel" | "wechat";
            callbackURL?: string | undefined;
            newUserCallbackURL?: string | undefined;
            errorCallbackURL?: string | undefined;
            disableRedirect?: boolean | undefined;
            idToken?: {
                token: string;
                nonce?: string | undefined;
                accessToken?: string | undefined;
                refreshToken?: string | undefined;
                expiresAt?: number | undefined;
                user?: {
                    name?: {
                        firstName?: string | undefined;
                        lastName?: string | undefined;
                    } | undefined;
                    email?: string | undefined;
                } | undefined;
            } | undefined;
            scopes?: string[] | undefined;
            requestSignUp?: boolean | undefined;
            loginHint?: string | undefined;
            additionalData?: Record<string, any> | undefined;
        }> & Record<string, any>, Partial<Record<string, any>> & Record<string, any>, Record<string, any> | undefined>>(data_0: better_auth.Prettify<{
            provider: (string & {}) | "linear" | "huggingface" | "google" | "discord" | "github" | "microsoft" | "apple" | "facebook" | "twitter" | "atlassian" | "cognito" | "figma" | "slack" | "spotify" | "twitch" | "dropbox" | "kick" | "linkedin" | "gitlab" | "tiktok" | "reddit" | "roblox" | "salesforce" | "vk" | "zoom" | "notion" | "kakao" | "naver" | "line" | "paybin" | "paypal" | "polar" | "railway" | "vercel" | "wechat";
            callbackURL?: string | undefined;
            newUserCallbackURL?: string | undefined;
            errorCallbackURL?: string | undefined;
            disableRedirect?: boolean | undefined;
            idToken?: {
                token: string;
                nonce?: string | undefined;
                accessToken?: string | undefined;
                refreshToken?: string | undefined;
                expiresAt?: number | undefined;
                user?: {
                    name?: {
                        firstName?: string | undefined;
                        lastName?: string | undefined;
                    } | undefined;
                    email?: string | undefined;
                } | undefined;
            } | undefined;
            scopes?: string[] | undefined;
            requestSignUp?: boolean | undefined;
            loginHint?: string | undefined;
            additionalData?: Record<string, any> | undefined;
        } & {
            fetchOptions?: FetchOptions | undefined;
        }>, data_1?: FetchOptions | undefined) => Promise<better_auth_client.BetterFetchResponse<{
            redirect: boolean;
            url: string;
        } | (Omit<{
            redirect: boolean;
            token: string;
            url: undefined;
            user: {
                id: string;
                createdAt: Date;
                updatedAt: Date;
                email: string;
                emailVerified: boolean;
                name: string;
                image?: string | null | undefined | undefined;
            };
        }, "user"> & {
            user: better_auth.StripEmptyObjects<{
                id: string;
                createdAt: Date;
                updatedAt: Date;
                email: string;
                emailVerified: boolean;
                name: string;
                image?: string | null | undefined;
            }>;
        }), {
            code?: string | undefined;
            message?: string | undefined;
        }, FetchOptions["throw"] extends true ? true : false>>;
    };
} & {
    signOut: <FetchOptions extends better_auth.ClientFetchOption<never, Partial<Record<string, any>> & Record<string, any>, Record<string, any> | undefined>>(data_0?: better_auth.Prettify<{
        query?: Record<string, any> | undefined;
        fetchOptions?: FetchOptions | undefined;
    }> | undefined, data_1?: FetchOptions | undefined) => Promise<better_auth_client.BetterFetchResponse<{
        success: boolean;
    }, {
        code?: string | undefined;
        message?: string | undefined;
    }, FetchOptions["throw"] extends true ? true : false>>;
} & {
    signUp: {
        email: <FetchOptions extends better_auth.ClientFetchOption<Partial<{
            name: string;
            email: string;
            password: string;
            image?: string | undefined;
            callbackURL?: string | undefined;
            rememberMe?: boolean | undefined;
        }> & Record<string, any>, Partial<Record<string, any>> & Record<string, any>, Record<string, any> | undefined>>(data_0: better_auth.Prettify<{
            email: string;
            name: string;
            password: string;
            image?: string | undefined;
            callbackURL?: string | undefined;
            fetchOptions?: FetchOptions | undefined;
        }>, data_1?: FetchOptions | undefined) => Promise<better_auth_client.BetterFetchResponse<(Omit<{
            token: null;
            user: {
                id: string;
                createdAt: Date;
                updatedAt: Date;
                email: string;
                emailVerified: boolean;
                name: string;
                image?: string | null | undefined | undefined;
            };
        }, "user"> & {
            user: better_auth.StripEmptyObjects<{
                id: string;
                createdAt: Date;
                updatedAt: Date;
                email: string;
                emailVerified: boolean;
                name: string;
                image?: string | null | undefined;
            }>;
        }) | (Omit<{
            token: string;
            user: {
                id: string;
                createdAt: Date;
                updatedAt: Date;
                email: string;
                emailVerified: boolean;
                name: string;
                image?: string | null | undefined | undefined;
            };
        }, "user"> & {
            user: better_auth.StripEmptyObjects<{
                id: string;
                createdAt: Date;
                updatedAt: Date;
                email: string;
                emailVerified: boolean;
                name: string;
                image?: string | null | undefined;
            }>;
        }), {
            code?: string | undefined;
            message?: string | undefined;
        }, FetchOptions["throw"] extends true ? true : false>>;
    };
} & {
    signIn: {
        email: <FetchOptions extends better_auth.ClientFetchOption<Partial<{
            email: string;
            password: string;
            callbackURL?: string | undefined;
            rememberMe?: boolean | undefined;
        }> & Record<string, any>, Partial<Record<string, any>> & Record<string, any>, Record<string, any> | undefined>>(data_0: better_auth.Prettify<{
            email: string;
            password: string;
            callbackURL?: string | undefined;
            rememberMe?: boolean | undefined;
        } & {
            fetchOptions?: FetchOptions | undefined;
        }>, data_1?: FetchOptions | undefined) => Promise<better_auth_client.BetterFetchResponse<Omit<{
            redirect: boolean;
            token: string;
            url?: string | undefined;
            user: {
                id: string;
                createdAt: Date;
                updatedAt: Date;
                email: string;
                emailVerified: boolean;
                name: string;
                image?: string | null | undefined | undefined;
            };
        }, "user"> & {
            user: better_auth.StripEmptyObjects<{
                id: string;
                createdAt: Date;
                updatedAt: Date;
                email: string;
                emailVerified: boolean;
                name: string;
                image?: string | null | undefined;
            }>;
        }, {
            code?: string | undefined;
            message?: string | undefined;
        }, FetchOptions["throw"] extends true ? true : false>>;
    };
} & {
    resetPassword: <FetchOptions extends better_auth.ClientFetchOption<Partial<{
        newPassword: string;
        token?: string | undefined;
    }> & Record<string, any>, Partial<{
        token?: string | undefined;
    }> & Record<string, any>, Record<string, any> | undefined>>(data_0: better_auth.Prettify<{
        newPassword: string;
        token?: string | undefined;
    } & {
        fetchOptions?: FetchOptions | undefined;
    }>, data_1?: FetchOptions | undefined) => Promise<better_auth_client.BetterFetchResponse<{
        status: boolean;
    }, {
        code?: string | undefined;
        message?: string | undefined;
    }, FetchOptions["throw"] extends true ? true : false>>;
} & {
    verifyEmail: <FetchOptions extends better_auth.ClientFetchOption<never, Partial<{
        token: string;
        callbackURL?: string | undefined;
    }> & Record<string, any>, Record<string, any> | undefined>>(data_0: better_auth.Prettify<{
        query: {
            token: string;
            callbackURL?: string | undefined;
        };
        fetchOptions?: FetchOptions | undefined;
    }>, data_1?: FetchOptions | undefined) => Promise<better_auth_client.BetterFetchResponse<NonNullable<void | {
        status: boolean;
    }>, {
        code?: string | undefined;
        message?: string | undefined;
    }, FetchOptions["throw"] extends true ? true : false>>;
} & {
    sendVerificationEmail: <FetchOptions extends better_auth.ClientFetchOption<Partial<{
        email: string;
        callbackURL?: string | undefined;
    }> & Record<string, any>, Partial<Record<string, any>> & Record<string, any>, Record<string, any> | undefined>>(data_0: better_auth.Prettify<{
        email: string;
        callbackURL?: string | undefined;
    } & {
        fetchOptions?: FetchOptions | undefined;
    }>, data_1?: FetchOptions | undefined) => Promise<better_auth_client.BetterFetchResponse<{
        status: boolean;
    }, {
        code?: string | undefined;
        message?: string | undefined;
    }, FetchOptions["throw"] extends true ? true : false>>;
} & {
    changeEmail: <FetchOptions extends better_auth.ClientFetchOption<Partial<{
        newEmail: string;
        callbackURL?: string | undefined;
    }> & Record<string, any>, Partial<Record<string, any>> & Record<string, any>, Record<string, any> | undefined>>(data_0: better_auth.Prettify<{
        newEmail: string;
        callbackURL?: string | undefined;
    } & {
        fetchOptions?: FetchOptions | undefined;
    }>, data_1?: FetchOptions | undefined) => Promise<better_auth_client.BetterFetchResponse<{
        status: boolean;
    }, {
        code?: string | undefined;
        message?: string | undefined;
    }, FetchOptions["throw"] extends true ? true : false>>;
} & {
    changePassword: <FetchOptions extends better_auth.ClientFetchOption<Partial<{
        newPassword: string;
        currentPassword: string;
        revokeOtherSessions?: boolean | undefined;
    }> & Record<string, any>, Partial<Record<string, any>> & Record<string, any>, Record<string, any> | undefined>>(data_0: better_auth.Prettify<{
        newPassword: string;
        currentPassword: string;
        revokeOtherSessions?: boolean | undefined;
    } & {
        fetchOptions?: FetchOptions | undefined;
    }>, data_1?: FetchOptions | undefined) => Promise<better_auth_client.BetterFetchResponse<Omit<{
        token: string | null;
        user: {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            email: string;
            emailVerified: boolean;
            name: string;
            image?: string | null | undefined;
        } & Record<string, any> & {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            email: string;
            emailVerified: boolean;
            name: string;
            image?: string | null | undefined;
        };
    }, "user"> & {
        user: better_auth.StripEmptyObjects<{
            id: string;
            createdAt: Date;
            updatedAt: Date;
            email: string;
            emailVerified: boolean;
            name: string;
            image?: string | null | undefined;
        }>;
    }, {
        code?: string | undefined;
        message?: string | undefined;
    }, FetchOptions["throw"] extends true ? true : false>>;
} & {
    updateSession: <FetchOptions extends better_auth.ClientFetchOption<Partial<Partial<{}>> & Record<string, any>, Partial<Record<string, any>> & Record<string, any>, Record<string, any> | undefined>>(data_0?: better_auth.Prettify<Partial<{}> & {
        fetchOptions?: FetchOptions | undefined;
    }> | undefined, data_1?: FetchOptions | undefined) => Promise<better_auth_client.BetterFetchResponse<{
        session: {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            userId: string;
            expiresAt: Date;
            token: string;
            ipAddress?: string | null | undefined;
            userAgent?: string | null | undefined;
        };
    }, {
        code?: string | undefined;
        message?: string | undefined;
    }, FetchOptions["throw"] extends true ? true : false>>;
} & {
    updateUser: <FetchOptions extends better_auth.ClientFetchOption<Partial<Partial<{}> & {
        name?: string | undefined;
        image?: string | undefined | null;
    }> & Record<string, any>, Partial<Record<string, any>> & Record<string, any>, Record<string, any> | undefined>>(data_0?: better_auth.Prettify<better_auth_client.InferUserUpdateCtx<{
        fetchOptions: {
            headers: {
                [x: string]: string;
            };
            body?: BodyInit | null;
            cache?: RequestCache;
            credentials: RequestCredentials;
            integrity?: string;
            keepalive?: boolean;
            method?: string;
            mode?: RequestMode;
            priority?: RequestPriority;
            redirect?: RequestRedirect;
            referrer?: string;
            referrerPolicy?: ReferrerPolicy;
            signal?: AbortSignal | null;
            window?: null;
        };
        sessionOptions?: {
            refetchInterval?: number;
            refetchOnWindowFocus?: boolean;
            refetchWhenOffline?: boolean;
        } | undefined;
        baseURL: string;
        plugins: BetterAuthClientPlugin[];
    }, FetchOptions>> | undefined, data_1?: FetchOptions | undefined) => Promise<better_auth_client.BetterFetchResponse<{
        status: boolean;
    }, {
        code?: string | undefined;
        message?: string | undefined;
    }, FetchOptions["throw"] extends true ? true : false>>;
} & {
    deleteUser: <FetchOptions extends better_auth.ClientFetchOption<Partial<{
        callbackURL?: string | undefined;
        password?: string | undefined;
        token?: string | undefined;
    }> & Record<string, any>, Partial<Record<string, any>> & Record<string, any>, Record<string, any> | undefined>>(data_0?: better_auth.Prettify<{
        callbackURL?: string | undefined;
        password?: string | undefined;
        token?: string | undefined;
    } & {
        fetchOptions?: FetchOptions | undefined;
    }> | undefined, data_1?: FetchOptions | undefined) => Promise<better_auth_client.BetterFetchResponse<{
        success: boolean;
        message: string;
    }, {
        code?: string | undefined;
        message?: string | undefined;
    }, FetchOptions["throw"] extends true ? true : false>>;
} & {
    requestPasswordReset: <FetchOptions extends better_auth.ClientFetchOption<Partial<{
        email: string;
        redirectTo?: string | undefined;
    }> & Record<string, any>, Partial<Record<string, any>> & Record<string, any>, Record<string, any> | undefined>>(data_0: better_auth.Prettify<{
        email: string;
        redirectTo?: string | undefined;
    } & {
        fetchOptions?: FetchOptions | undefined;
    }>, data_1?: FetchOptions | undefined) => Promise<better_auth_client.BetterFetchResponse<{
        status: boolean;
        message: string;
    }, {
        code?: string | undefined;
        message?: string | undefined;
    }, FetchOptions["throw"] extends true ? true : false>>;
} & {
    resetPassword: {
        ":token": <FetchOptions extends better_auth.ClientFetchOption<never, Partial<{
            callbackURL: string;
        }> & Record<string, any>, {
            token: string;
        }>>(data_0: better_auth.Prettify<{
            query: {
                callbackURL: string;
            };
            fetchOptions?: FetchOptions | undefined;
        }>, data_1?: FetchOptions | undefined) => Promise<better_auth_client.BetterFetchResponse<never, {
            code?: string | undefined;
            message?: string | undefined;
        }, FetchOptions["throw"] extends true ? true : false>>;
    };
} & {
    listSessions: <FetchOptions extends better_auth.ClientFetchOption<never, Partial<Record<string, any>> & Record<string, any>, Record<string, any> | undefined>>(data_0?: better_auth.Prettify<{
        query?: Record<string, any> | undefined;
        fetchOptions?: FetchOptions | undefined;
    }> | undefined, data_1?: FetchOptions | undefined) => Promise<better_auth_client.BetterFetchResponse<better_auth.Prettify<{
        id: string;
        createdAt: Date;
        updatedAt: Date;
        userId: string;
        expiresAt: Date;
        token: string;
        ipAddress?: string | null | undefined | undefined;
        userAgent?: string | null | undefined | undefined;
    }>[], {
        code?: string | undefined;
        message?: string | undefined;
    }, FetchOptions["throw"] extends true ? true : false>>;
} & {
    revokeSession: <FetchOptions extends better_auth.ClientFetchOption<Partial<{
        token: string;
    }> & Record<string, any>, Partial<Record<string, any>> & Record<string, any>, Record<string, any> | undefined>>(data_0: better_auth.Prettify<{
        token: string;
    } & {
        fetchOptions?: FetchOptions | undefined;
    }>, data_1?: FetchOptions | undefined) => Promise<better_auth_client.BetterFetchResponse<{
        status: boolean;
    }, {
        code?: string | undefined;
        message?: string | undefined;
    }, FetchOptions["throw"] extends true ? true : false>>;
} & {
    revokeSessions: <FetchOptions extends better_auth.ClientFetchOption<never, Partial<Record<string, any>> & Record<string, any>, Record<string, any> | undefined>>(data_0?: better_auth.Prettify<{
        query?: Record<string, any> | undefined;
        fetchOptions?: FetchOptions | undefined;
    }> | undefined, data_1?: FetchOptions | undefined) => Promise<better_auth_client.BetterFetchResponse<{
        status: boolean;
    }, {
        code?: string | undefined;
        message?: string | undefined;
    }, FetchOptions["throw"] extends true ? true : false>>;
} & {
    revokeOtherSessions: <FetchOptions extends better_auth.ClientFetchOption<never, Partial<Record<string, any>> & Record<string, any>, Record<string, any> | undefined>>(data_0?: better_auth.Prettify<{
        query?: Record<string, any> | undefined;
        fetchOptions?: FetchOptions | undefined;
    }> | undefined, data_1?: FetchOptions | undefined) => Promise<better_auth_client.BetterFetchResponse<{
        status: boolean;
    }, {
        code?: string | undefined;
        message?: string | undefined;
    }, FetchOptions["throw"] extends true ? true : false>>;
} & {
    linkSocial: <FetchOptions extends better_auth.ClientFetchOption<Partial<{
        provider: unknown;
        callbackURL?: string | undefined;
        idToken?: {
            token: string;
            nonce?: string | undefined;
            accessToken?: string | undefined;
            refreshToken?: string | undefined;
            scopes?: string[] | undefined;
        } | undefined;
        requestSignUp?: boolean | undefined;
        scopes?: string[] | undefined;
        errorCallbackURL?: string | undefined;
        disableRedirect?: boolean | undefined;
        additionalData?: Record<string, any> | undefined;
    }> & Record<string, any>, Partial<Record<string, any>> & Record<string, any>, Record<string, any> | undefined>>(data_0: better_auth.Prettify<{
        provider: unknown;
        callbackURL?: string | undefined;
        idToken?: {
            token: string;
            nonce?: string | undefined;
            accessToken?: string | undefined;
            refreshToken?: string | undefined;
            scopes?: string[] | undefined;
        } | undefined;
        requestSignUp?: boolean | undefined;
        scopes?: string[] | undefined;
        errorCallbackURL?: string | undefined;
        disableRedirect?: boolean | undefined;
        additionalData?: Record<string, any> | undefined;
    } & {
        fetchOptions?: FetchOptions | undefined;
    }>, data_1?: FetchOptions | undefined) => Promise<better_auth_client.BetterFetchResponse<{
        url: string;
        redirect: boolean;
    }, {
        code?: string | undefined;
        message?: string | undefined;
    }, FetchOptions["throw"] extends true ? true : false>>;
} & {
    listAccounts: <FetchOptions extends better_auth.ClientFetchOption<never, Partial<Record<string, any>> & Record<string, any>, Record<string, any> | undefined>>(data_0?: better_auth.Prettify<{
        query?: Record<string, any> | undefined;
        fetchOptions?: FetchOptions | undefined;
    }> | undefined, data_1?: FetchOptions | undefined) => Promise<better_auth_client.BetterFetchResponse<{
        scopes: string[];
        id: string;
        createdAt: Date;
        updatedAt: Date;
        userId: string;
        providerId: string;
        accountId: string;
    }[], {
        code?: string | undefined;
        message?: string | undefined;
    }, FetchOptions["throw"] extends true ? true : false>>;
} & {
    deleteUser: {
        callback: <FetchOptions extends better_auth.ClientFetchOption<never, Partial<{
            token: string;
            callbackURL?: string | undefined;
        }> & Record<string, any>, Record<string, any> | undefined>>(data_0: better_auth.Prettify<{
            query: {
                token: string;
                callbackURL?: string | undefined;
            };
            fetchOptions?: FetchOptions | undefined;
        }>, data_1?: FetchOptions | undefined) => Promise<better_auth_client.BetterFetchResponse<{
            success: boolean;
            message: string;
        }, {
            code?: string | undefined;
            message?: string | undefined;
        }, FetchOptions["throw"] extends true ? true : false>>;
    };
} & {
    unlinkAccount: <FetchOptions extends better_auth.ClientFetchOption<Partial<{
        providerId: string;
        accountId?: string | undefined;
    }> & Record<string, any>, Partial<Record<string, any>> & Record<string, any>, Record<string, any> | undefined>>(data_0: better_auth.Prettify<{
        providerId: string;
        accountId?: string | undefined;
    } & {
        fetchOptions?: FetchOptions | undefined;
    }>, data_1?: FetchOptions | undefined) => Promise<better_auth_client.BetterFetchResponse<{
        status: boolean;
    }, {
        code?: string | undefined;
        message?: string | undefined;
    }, FetchOptions["throw"] extends true ? true : false>>;
} & {
    refreshToken: <FetchOptions extends better_auth.ClientFetchOption<Partial<{
        providerId: string;
        accountId?: string | undefined;
        userId?: string | undefined;
    }> & Record<string, any>, Partial<Record<string, any>> & Record<string, any>, Record<string, any> | undefined>>(data_0: better_auth.Prettify<{
        providerId: string;
        accountId?: string | undefined;
        userId?: string | undefined;
    } & {
        fetchOptions?: FetchOptions | undefined;
    }>, data_1?: FetchOptions | undefined) => Promise<better_auth_client.BetterFetchResponse<{
        accessToken: string | undefined;
        refreshToken: string;
        accessTokenExpiresAt: Date | undefined;
        refreshTokenExpiresAt: Date | null | undefined;
        scope: string | null | undefined;
        idToken: string | null | undefined;
        providerId: string;
        accountId: string;
    }, {
        code?: string | undefined;
        message?: string | undefined;
    }, FetchOptions["throw"] extends true ? true : false>>;
} & {
    getAccessToken: <FetchOptions extends better_auth.ClientFetchOption<Partial<{
        providerId: string;
        accountId?: string | undefined;
        userId?: string | undefined;
    }> & Record<string, any>, Partial<Record<string, any>> & Record<string, any>, Record<string, any> | undefined>>(data_0: better_auth.Prettify<{
        providerId: string;
        accountId?: string | undefined;
        userId?: string | undefined;
    } & {
        fetchOptions?: FetchOptions | undefined;
    }>, data_1?: FetchOptions | undefined) => Promise<better_auth_client.BetterFetchResponse<{
        accessToken: string;
        accessTokenExpiresAt: Date | undefined;
        scopes: string[];
        idToken: string | undefined;
    }, {
        code?: string | undefined;
        message?: string | undefined;
    }, FetchOptions["throw"] extends true ? true : false>>;
} & {
    accountInfo: <FetchOptions extends better_auth.ClientFetchOption<never, Partial<{
        accountId?: string | undefined;
    }> & Record<string, any>, Record<string, any> | undefined>>(data_0?: better_auth.Prettify<{
        query?: {
            accountId?: string | undefined;
        } | undefined;
        fetchOptions?: FetchOptions | undefined;
    }> | undefined, data_1?: FetchOptions | undefined) => Promise<better_auth_client.BetterFetchResponse<{
        user: better_auth.OAuth2UserInfo;
        data: Record<string, any>;
    }, {
        code?: string | undefined;
        message?: string | undefined;
    }, FetchOptions["throw"] extends true ? true : false>>;
} & {
    getSession: <FetchOptions extends better_auth.ClientFetchOption<never, Partial<{
        disableCookieCache?: unknown;
        disableRefresh?: unknown;
    }> & Record<string, any>, Record<string, any> | undefined>>(data_0?: better_auth.Prettify<{
        query?: {
            disableCookieCache?: unknown;
            disableRefresh?: unknown;
        } | undefined;
        fetchOptions?: FetchOptions | undefined;
    }> | undefined, data_1?: FetchOptions | undefined) => Promise<better_auth_client.BetterFetchResponse<{
        user: better_auth.StripEmptyObjects<{
            id: string;
            createdAt: Date;
            updatedAt: Date;
            email: string;
            emailVerified: boolean;
            name: string;
            image?: string | null | undefined;
        }>;
        session: better_auth.StripEmptyObjects<{
            id: string;
            createdAt: Date;
            updatedAt: Date;
            userId: string;
            expiresAt: Date;
            token: string;
            ipAddress?: string | null | undefined;
            userAgent?: string | null | undefined;
        }>;
    } | null, {
        code?: string | undefined;
        message?: string | undefined;
    }, FetchOptions["throw"] extends true ? true : false>>;
} & {
    useSession: () => {
        data: {
            user: better_auth.StripEmptyObjects<{
                id: string;
                createdAt: Date;
                updatedAt: Date;
                email: string;
                emailVerified: boolean;
                name: string;
                image?: string | null | undefined;
            }>;
            session: better_auth.StripEmptyObjects<{
                id: string;
                createdAt: Date;
                updatedAt: Date;
                userId: string;
                expiresAt: Date;
                token: string;
                ipAddress?: string | null | undefined;
                userAgent?: string | null | undefined;
            }>;
        } | null;
        isPending: boolean;
        isRefetching: boolean;
        error: better_auth_client.BetterFetchError | null;
        refetch: (queryParams?: {
            query?: better_auth.SessionQueryParams;
        } | undefined) => Promise<void>;
    };
    $Infer: {
        Session: {
            user: better_auth.StripEmptyObjects<{
                id: string;
                createdAt: Date;
                updatedAt: Date;
                email: string;
                emailVerified: boolean;
                name: string;
                image?: string | null | undefined;
            }>;
            session: better_auth.StripEmptyObjects<{
                id: string;
                createdAt: Date;
                updatedAt: Date;
                userId: string;
                expiresAt: Date;
                token: string;
                ipAddress?: string | null | undefined;
                userAgent?: string | null | undefined;
            }>;
        };
    };
    $fetch: better_auth_client.BetterFetch<{
        plugins: (better_auth_client.BetterFetchPlugin<Record<string, any>> | {
            id: string;
            name: string;
            hooks: {
                onSuccess(context: better_auth_client.SuccessContext<any>): void;
            };
        } | {
            id: string;
            name: string;
            hooks: {
                onSuccess: ((context: better_auth_client.SuccessContext<any>) => Promise<void> | void) | undefined;
                onError: ((context: better_auth_client.ErrorContext) => Promise<void> | void) | undefined;
                onRequest: (<T extends Record<string, any>>(context: better_auth_client.RequestContext<T>) => Promise<better_auth_client.RequestContext | void> | better_auth_client.RequestContext | void) | undefined;
                onResponse: ((context: better_auth_client.ResponseContext) => Promise<Response | void | better_auth_client.ResponseContext> | Response | better_auth_client.ResponseContext | void) | undefined;
            };
        })[];
        priority?: RequestPriority | undefined;
        cache?: RequestCache | undefined;
        credentials?: RequestCredentials;
        headers?: (HeadersInit & (HeadersInit | {
            accept: "application/json" | "text/plain" | "application/octet-stream";
            "content-type": "application/json" | "text/plain" | "application/x-www-form-urlencoded" | "multipart/form-data" | "application/octet-stream";
            authorization: "Bearer" | "Basic";
        })) | undefined;
        integrity?: string | undefined;
        keepalive?: boolean | undefined;
        method: string;
        mode?: RequestMode | undefined;
        redirect?: RequestRedirect | undefined;
        referrer?: string | undefined;
        referrerPolicy?: ReferrerPolicy | undefined;
        signal?: (AbortSignal | null) | undefined;
        window?: null | undefined;
        onRetry?: ((response: better_auth_client.ResponseContext) => Promise<void> | void) | undefined;
        hookOptions?: {
            cloneResponse?: boolean;
        } | undefined;
        timeout?: number | undefined;
        customFetchImpl: better_auth_client.FetchEsque;
        baseURL: string;
        throw?: boolean | undefined;
        auth?: ({
            type: "Bearer";
            token: string | Promise<string | undefined> | (() => string | Promise<string | undefined> | undefined) | undefined;
        } | {
            type: "Basic";
            username: string | (() => string | undefined) | undefined;
            password: string | (() => string | undefined) | undefined;
        } | {
            type: "Custom";
            prefix: string | (() => string | undefined) | undefined;
            value: string | (() => string | undefined) | undefined;
        }) | undefined;
        body?: any;
        query?: any;
        params?: any;
        duplex?: "full" | "half" | undefined;
        jsonParser: (text: string) => Promise<any> | any;
        retry?: better_auth_client.RetryOptions | undefined;
        retryAttempt?: number | undefined;
        output?: (better_auth_client.StandardSchemaV1 | typeof Blob | typeof File) | undefined;
        errorSchema?: better_auth_client.StandardSchemaV1 | undefined;
        disableValidation?: boolean | undefined;
        disableSignal?: boolean | undefined;
    }, unknown, unknown, {}>;
    $store: {
        notify: (signal?: (Omit<string, "$sessionSignal"> | "$sessionSignal") | undefined) => void;
        listen: (signal: Omit<string, "$sessionSignal"> | "$sessionSignal", listener: (value: boolean, oldValue?: boolean | undefined) => void) => void;
        atoms: Record<string, better_auth_client.WritableAtom<any>>;
    };
    $ERROR_CODES: {
        USER_NOT_FOUND: better_auth.RawError<"USER_NOT_FOUND">;
        FAILED_TO_CREATE_USER: better_auth.RawError<"FAILED_TO_CREATE_USER">;
        FAILED_TO_CREATE_SESSION: better_auth.RawError<"FAILED_TO_CREATE_SESSION">;
        FAILED_TO_UPDATE_USER: better_auth.RawError<"FAILED_TO_UPDATE_USER">;
        FAILED_TO_GET_SESSION: better_auth.RawError<"FAILED_TO_GET_SESSION">;
        INVALID_PASSWORD: better_auth.RawError<"INVALID_PASSWORD">;
        INVALID_EMAIL: better_auth.RawError<"INVALID_EMAIL">;
        INVALID_EMAIL_OR_PASSWORD: better_auth.RawError<"INVALID_EMAIL_OR_PASSWORD">;
        INVALID_USER: better_auth.RawError<"INVALID_USER">;
        SOCIAL_ACCOUNT_ALREADY_LINKED: better_auth.RawError<"SOCIAL_ACCOUNT_ALREADY_LINKED">;
        PROVIDER_NOT_FOUND: better_auth.RawError<"PROVIDER_NOT_FOUND">;
        INVALID_TOKEN: better_auth.RawError<"INVALID_TOKEN">;
        TOKEN_EXPIRED: better_auth.RawError<"TOKEN_EXPIRED">;
        ID_TOKEN_NOT_SUPPORTED: better_auth.RawError<"ID_TOKEN_NOT_SUPPORTED">;
        FAILED_TO_GET_USER_INFO: better_auth.RawError<"FAILED_TO_GET_USER_INFO">;
        USER_EMAIL_NOT_FOUND: better_auth.RawError<"USER_EMAIL_NOT_FOUND">;
        EMAIL_NOT_VERIFIED: better_auth.RawError<"EMAIL_NOT_VERIFIED">;
        PASSWORD_TOO_SHORT: better_auth.RawError<"PASSWORD_TOO_SHORT">;
        PASSWORD_TOO_LONG: better_auth.RawError<"PASSWORD_TOO_LONG">;
        USER_ALREADY_EXISTS: better_auth.RawError<"USER_ALREADY_EXISTS">;
        USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: better_auth.RawError<"USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL">;
        EMAIL_CAN_NOT_BE_UPDATED: better_auth.RawError<"EMAIL_CAN_NOT_BE_UPDATED">;
        CREDENTIAL_ACCOUNT_NOT_FOUND: better_auth.RawError<"CREDENTIAL_ACCOUNT_NOT_FOUND">;
        ACCOUNT_NOT_FOUND: better_auth.RawError<"ACCOUNT_NOT_FOUND">;
        SESSION_EXPIRED: better_auth.RawError<"SESSION_EXPIRED">;
        FAILED_TO_UNLINK_LAST_ACCOUNT: better_auth.RawError<"FAILED_TO_UNLINK_LAST_ACCOUNT">;
        USER_ALREADY_HAS_PASSWORD: better_auth.RawError<"USER_ALREADY_HAS_PASSWORD">;
        CROSS_SITE_NAVIGATION_LOGIN_BLOCKED: better_auth.RawError<"CROSS_SITE_NAVIGATION_LOGIN_BLOCKED">;
        VERIFICATION_EMAIL_NOT_ENABLED: better_auth.RawError<"VERIFICATION_EMAIL_NOT_ENABLED">;
        EMAIL_ALREADY_VERIFIED: better_auth.RawError<"EMAIL_ALREADY_VERIFIED">;
        EMAIL_MISMATCH: better_auth.RawError<"EMAIL_MISMATCH">;
        SESSION_NOT_FRESH: better_auth.RawError<"SESSION_NOT_FRESH">;
        LINKED_ACCOUNT_ALREADY_EXISTS: better_auth.RawError<"LINKED_ACCOUNT_ALREADY_EXISTS">;
        INVALID_ORIGIN: better_auth.RawError<"INVALID_ORIGIN">;
        INVALID_CALLBACK_URL: better_auth.RawError<"INVALID_CALLBACK_URL">;
        INVALID_REDIRECT_URL: better_auth.RawError<"INVALID_REDIRECT_URL">;
        INVALID_ERROR_CALLBACK_URL: better_auth.RawError<"INVALID_ERROR_CALLBACK_URL">;
        INVALID_NEW_USER_CALLBACK_URL: better_auth.RawError<"INVALID_NEW_USER_CALLBACK_URL">;
        MISSING_OR_NULL_ORIGIN: better_auth.RawError<"MISSING_OR_NULL_ORIGIN">;
        CALLBACK_URL_REQUIRED: better_auth.RawError<"CALLBACK_URL_REQUIRED">;
        FAILED_TO_CREATE_VERIFICATION: better_auth.RawError<"FAILED_TO_CREATE_VERIFICATION">;
        FIELD_NOT_ALLOWED: better_auth.RawError<"FIELD_NOT_ALLOWED">;
        ASYNC_VALIDATION_NOT_SUPPORTED: better_auth.RawError<"ASYNC_VALIDATION_NOT_SUPPORTED">;
        VALIDATION_ERROR: better_auth.RawError<"VALIDATION_ERROR">;
        MISSING_FIELD: better_auth.RawError<"MISSING_FIELD">;
        METHOD_NOT_ALLOWED_DEFER_SESSION_REQUIRED: better_auth.RawError<"METHOD_NOT_ALLOWED_DEFER_SESSION_REQUIRED">;
        BODY_MUST_BE_AN_OBJECT: better_auth.RawError<"BODY_MUST_BE_AN_OBJECT">;
        PASSWORD_ALREADY_SET: better_auth.RawError<"PASSWORD_ALREADY_SET">;
    };
};
/** The resolved type of the auth client returned by `createKovaAuthClient`. */
type KovaAuthClient = ReturnType<typeof createKovaAuthClient>;

interface ServerAppearance {
    displayName: string;
    logoUrl: string | null;
    faviconUrl: string | null;
    primaryColor: string | null;
    backgroundColor: string | null;
    theme: "dark" | "light" | "auto";
    homeUrl: string | null;
    termsUrl: string | null;
    privacyUrl: string | null;
    /** Whether the app has paid to suppress the kova-auth badge. */
    hideBranding: boolean;
    /** Provider IDs enabled in the dashboard, e.g. ["google","github"] */
    enabledProviders: string[];
}
interface KovaAuthContextValue {
    client: KovaAuthClient;
    authUrl: string;
    /** The publishable key used to initialise this Provider instance. */
    publishableKey?: string;
    appearance: Appearance;
    vars: Required<AppearanceVariables>;
    oauthProviders: OAuthProvider[];
    /** Live server-fetched branding — null until the first fetch resolves. */
    serverAppearance: ServerAppearance | null;
    /** True once server appearance has resolved, or immediately when no publishable key is used. */
    isAppearanceLoaded: boolean;
    afterSignInUrl: string;
    afterSignUpUrl: string;
    afterSignOutUrl: string;
    mode: "live" | "test";
    isPlatformAdmin: boolean;
    /** Shared session subscription — sourced once from client.useSession(). */
    sessionResult: ReturnType<KovaAuthClient["useSession"]>;
    /** Raw Better Auth session token suitable for Authorization: Bearer. */
    sessionToken: string | null;
    /**
     * Clears the in-memory Bearer session token (cross-origin SDK sign-out).
     *
     * Calling this signs the user out **of this SDK-powered app only** without
     * invalidating the Better Auth session on the auth server. The platform
     * admin dashboard (auth.115jon.site) remains signed in. Use `client.signOut()`
     * when you also want to destroy the server-side session for everyone.
     */
    clearSessionToken: () => void;
    /**
     * True when a cross-origin Bearer token is active (OAuth transfer flow).
     * Components can use this to adjust sign-out behaviour.
     */
    hasBearerSession: boolean;
}
interface KovaAuthProviderProps extends KovaAuthConfig {
    children: ReactNode;
}
declare function KovaAuthProvider({ children, publishableKey, authUrl, plugins, appearance, oauthProviders, manageFavicon, sessionOptions, initialSessionToken, onSessionTokenChange, isPlatformAdmin, afterSignInUrl, afterSignUpUrl, afterSignOutUrl, ...rest }: KovaAuthProviderProps & {
    isPlatformAdmin?: boolean;
}): react_jsx_runtime.JSX.Element;
declare function useKovaAuth(): KovaAuthContextValue;

declare const KNOWN_PROVIDERS: readonly ["credential", "google", "discord", "github", "microsoft", "apple", "facebook"];
type KnownProvider = (typeof KNOWN_PROVIDERS)[number];
interface ConnectedAccountsProps {
    /**
     * If set, only show rows for these providers (defaults to all KNOWN_PROVIDERS).
     * Useful for pages that only want to show the social providers.
     */
    providers?: KnownProvider[];
    /**
     * URL redirected to after a successful OAuth link.
     * Defaults to the current page URL.
     */
    callbackURL?: string;
    /** Appearance element overrides. */
    elements?: AppearanceElements;
    /** Compact = single column list (default). Wide = 2-col grid when space allows. */
    layout?: "compact" | "wide";
}
declare function ConnectedAccounts({ providers, callbackURL, elements, layout, }: ConnectedAccountsProps): react_jsx_runtime.JSX.Element;

declare function OrgSwitcher({ hideWhenLoading, hideWhenNoOrgs, appearance: instanceAppearance, className, }: OrgSwitcherProps): react_jsx_runtime.JSX.Element | null;

declare function Protect({ condition, role, fallback, loading, children, }: ProtectProps): react_jsx_runtime.JSX.Element;

declare function SignIn({ afterSignInUrl, signUpUrl, defaultTab, appearance: instanceAppearance, className, }: SignInProps): react_jsx_runtime.JSX.Element;

declare function SignUp({ afterSignUpUrl, signInUrl, appearance: instanceAppearance, className, }: SignUpProps): react_jsx_runtime.JSX.Element;

declare function UserButton({ afterSignOutUrl, showName, size, appearance: instanceAppearance, className, }: UserButtonProps): react_jsx_runtime.JSX.Element | null;

/**
 * useAuth — combined auth state hook.
 *
 * A convenience hook that mirrors Clerk's `useAuth()` API for teams
 * already familiar with Clerk. Provides everything you need for a typical
 * "is the user signed in?" check without composing multiple hooks.
 *
 * @example
 * ```tsx
 * const { isSignedIn, isLoaded, userId, getToken } = useAuth();
 * if (!isLoaded) return <Spinner />;
 * if (!isSignedIn) return null;
 * ```
 */
interface UseAuthReturn {
    /** `false` until the initial session check completes (prevents flash of wrong UI). */
    isLoaded: boolean;
    /** `true` when a valid session exists. */
    isSignedIn: boolean;
    /** The current user's ID, or `null` if not signed in. */
    userId: string | null;
    /** HMAC session token (the raw Better Auth token), or `null`. */
    sessionId: string | null;
    orgId: string | null;
    orgRole: string | null;
    /** Return the current raw session token for bearer-authenticated app APIs. */
    getToken: () => Promise<string | null>;
    /** Imperatively sign out. */
    signOut: (callbackURL?: string) => Promise<void>;
}
declare function useAuth(): UseAuthReturn;

/**
 * useLinkedAccounts — list and manage the provider accounts linked to
 * the currently authenticated user.
 *
 * Calls `client.listAccounts()` (Better Auth built-in) to enumerate every
 * row from the `account` table that belongs to the current user.
 *
 * @example
 * ```tsx
 * const { accounts, isLoaded, linkAccount } = useLinkedAccounts();
 *
 * // Initiate linking a new provider:
 * await linkAccount({ provider: "github", callbackURL: "/settings" });
 *
 * // Display a "Connect Google" button when google is not yet linked:
 * const hasGoogle = accounts.some(a => a.providerId === "google");
 * ```
 */

declare function useLinkedAccounts(): UseLinkedAccountsReturn;

/**
 * useOrganization — active organization and current user's membership.
 *
 * Reactive: re-renders automatically when the active org changes (e.g. after
 * calling `client.organization.setActive()`).
 *
 * @example
 * ```tsx
 * const { organization, membership, isLoaded } = useOrganization();
 * if (!isLoaded) return null;
 * if (!organization) return <p>No active org</p>;
 * return <h1>{organization.name}</h1>;
 * ```
 */

declare function useOrganization(): UseOrganizationReturn;

/**
 * useSession — current auth session state.
 *
 * Returns the raw session + user objects along with derived booleans.
 * Equivalent to Clerk's `useAuth()` but typed against kova-auth's user model.
 *
 * @example
 * ```tsx
 * const { session, isLoaded, isSignedIn } = useSession();
 * if (!isLoaded) return <Spinner />;
 * if (!isSignedIn) return <Redirect to="/sign-in" />;
 * return <Dashboard user={session.user} />;
 * ```
 */

declare function useSession(): UseSessionReturn;

/**
 * useSignIn — imperative sign-in actions.
 *
 * Provides typed methods for every auth flow: email/password, magic link,
 * OAuth redirect, passkey, and TOTP verification. Tracks loading / error
 * state per-action so you can build a completely custom sign-in UI.
 *
 * Now includes rate-limit awareness: when the server returns 429, the hook
 * parses the `Retry-After` response header and exposes `retryAfterSeconds`
 * in the return value so callers can present an accurate countdown to the user.
 *
 * @example
 * ```tsx
 * const { signIn, isLoading, error, retryAfterSeconds } = useSignIn();
 *
 * async function handleSubmit(e: FormEvent) {
 *   e.preventDefault();
 *   await signIn.email({ email, password });
 * }
 * ```
 */
interface SignInEmailOpts {
    email: string;
    password: string;
    rememberMe?: boolean;
    /** Override the URL to redirect. Inherits from provider if omitted. */
    callbackURL?: string;
}
interface SignInMagicLinkOpts {
    email: string;
    callbackURL?: string;
}
interface SignInSocialOpts {
    provider: string;
    callbackURL?: string;
    errorCallbackURL?: string;
}
interface SignInPasskeyOpts {
    callbackURL?: string;
}
interface SignInTOTPOpts {
    code: string;
}
interface SignInEmailOtpVerifyOpts {
    email: string;
    otp: string;
}
interface UseSignInReturn {
    signIn: {
        /**
         * Sign in with email + password.
         * Returns `{ twoFactorRequired: true }` if 2FA is pending.
         */
        email: (opts: SignInEmailOpts) => Promise<{
            twoFactorRequired?: boolean;
        }>;
        /** Send a magic link email — user clicks it to sign in. */
        magicLink: (opts: SignInMagicLinkOpts) => Promise<void>;
        /** Redirect to an OAuth provider's consent page. */
        social: (opts: SignInSocialOpts) => Promise<void>;
        /** Authenticate with a registered WebAuthn passkey. */
        passkey: (opts?: SignInPasskeyOpts) => Promise<void>;
        /** Submit a TOTP code for pending 2FA challenge. */
        totp: (opts: SignInTOTPOpts) => Promise<void>;
        /** Verify an email OTP for pending 2FA challenge. */
        emailOtp: (opts: SignInEmailOtpVerifyOpts) => Promise<void>;
    };
    /** `true` while any sign-in action is in flight. */
    isLoading: boolean;
    /** Last error message from a failed sign-in attempt. `null` if none. */
    error: string | null;
    /** Clears the current error. */
    clearError: () => void;
    /**
     * Present when email/password sign-in succeeds but the server requires a
     * 2FA step before granting a full session.
     */
    twoFactorRequired: boolean;
    /**
     * Set to the `Retry-After` value (in seconds) when the server returns 429.
     * `null` when not rate-limited.
     *
     * Pass this to `useRateLimit().recordRateLimit()` to start a countdown,
     * or use the convenience `<RateLimitBanner>` component directly.
     */
    retryAfterSeconds: number | null;
}
declare function useSignIn(): UseSignInReturn;

/**
 * useSignUp — imperative sign-up actions.
 *
 * Supports email/password registration with optional username.
 * After successful registration, the user is redirected to `afterSignUpUrl`
 * (from provider config) unless overridden per-call.
 *
 * Now includes rate-limit awareness: when the server returns 429, the hook
 * parses the `Retry-After` response header and exposes `retryAfterSeconds`
 * in the return value so callers can present an accurate countdown to the user.
 */
interface SignUpEmailOpts {
    email: string;
    password: string;
    name: string;
    username?: string;
    callbackURL?: string;
}
interface UseSignUpReturn {
    signUp: {
        /** Register a new account with email + password. */
        email: (opts: SignUpEmailOpts) => Promise<void>;
    };
    isLoading: boolean;
    error: string | null;
    clearError: () => void;
    /**
     * `true` after successful registration when email verification is required.
     * Show a "check your email" message in this state.
     */
    verificationPending: boolean;
    /**
     * Set to the `Retry-After` value (in seconds) when the server returns 429.
     * `null` when not rate-limited.
     *
     * Pass this to `useRateLimit().recordRateLimit()` to start a countdown,
     * or use the convenience `<RateLimitBanner>` component directly.
     */
    retryAfterSeconds: number | null;
}
declare function useSignUp(): UseSignUpReturn;

/**
 * useUser — the currently signed-in user record.
 *
 * Provides the user object and an `updateUser` imperative method that
 * patches the user's profile and automatically refreshes the session.
 *
 * @example
 * ```tsx
 * const { user, isLoaded, isSignedIn, updateUser } = useUser();
 *
 * async function handleNameChange(newName: string) {
 *   await updateUser({ name: newName });
 * }
 * ```
 */

declare function useUser(): UseUserReturn;

/**
 * useRateLimit — rate-limit countdown state for auth forms.
 *
 * Consumes the `Retry-After` header value from a 429 response and manages a
 * live countdown that re-enables the form exactly when the server window resets.
 *
 * Design goals:
 *  - Zero-dependency: only React hooks, no external timers library.
 *  - Drift-free: uses `Date.now()` endpoints, not cumulative intervals.
 *  - Persistent: survives re-renders (state, not ref-only).
 *  - Multiple calls safe: each `recordRateLimit` restarts the timer from scratch.
 *
 * @example
 * ```tsx
 * const { isRateLimited, secondsRemaining, recordRateLimit } = useRateLimit();
 *
 * // When a 429 is received:
 * recordRateLimit(retryAfterSeconds);
 *
 * // In JSX:
 * <SubmitButton disabled={isRateLimited || isLoading}>…</SubmitButton>
 * {isRateLimited && <RateLimitBanner secondsRemaining={secondsRemaining} />}
 * ```
 */
interface UseRateLimitReturn {
    /**
     * `true` while the rate-limit window is active (secondsRemaining > 0).
     * Subscribe to this to disable submit buttons and block re-submission.
     */
    isRateLimited: boolean;
    /**
     * Whole-number countdown in seconds.  Starts at the Retry-After value and
     * ticks down to 0, at which point `isRateLimited` becomes `false`.
     */
    secondsRemaining: number;
    /**
     * Call this when a 429 response is received.
     * Pass the `Retry-After` header value in seconds.
     * Accepts floats (from fractional server values) — always rounded up.
     *
     * @param retryAfterSeconds - Number of seconds to wait.  Must be ≥ 1.
     */
    recordRateLimit: (retryAfterSeconds: number) => void;
    /**
     * Imperatively clear the rate-limit state (e.g., when the user navigates
     * away from the form or the component unmounts unexpectedly).
     */
    clearRateLimit: () => void;
}
declare function useRateLimit(): UseRateLimitReturn;
/**
 * Extracts the `Retry-After` value (in seconds) from a Better Auth / HTTP
 * error response.  Returns `null` if the value is absent or unparseable.
 *
 * Better Auth emits `Retry-After` as an integer-seconds HTTP header.
 * Some responses also include `x-ratelimit-reset` (Unix epoch seconds) —
 * we support both and prefer `Retry-After`.
 *
 * Called in hook error-path so it must never throw.
 */
declare function extractRetryAfter(err: unknown): number | null;
/**
 * Returns a user-friendly message for rate-limited states.
 * Used in `RateLimitBanner` to avoid hardcoding strings in the component.
 */
declare function rateLimitMessage(secondsRemaining: number): string;

/**
 * Publishable key utilities.
 *
 * A publishable key is a **client-side URL encoding convenience** — it encodes
 * the auth server URL in a Clerk-compatible format so consumers don't have to
 * manage raw URLs directly:
 *
 *   pk_live_<base64(JSON.stringify(payload))>
 *   pk_test_<base64(JSON.stringify(payload))>
 *
 * Payload: `{ v: 1, authUrl: string, appId?: string }`
 *
 * ⚠️  IMPORTANT: The kova-auth server does NOT validate, register, or enforce
 *    publishable keys. There is no key-generation API or key-lookup endpoint.
 *    The key is simply a way to encode the server URL into a single opaque string.
 *    It contains NO secrets and is safe to embed in client-side code.
 *
 * If you prefer simplicity, pass `authUrl` directly to `<KovaAuthProvider>`.
 */
/**
 * Creates a publishable key from an auth server URL.
 *
 * @example
 * ```ts
 * const key = encodePublishableKey("https://auth.example.com");
 * // → "pk_live_eyJ2IjoxLCJhdXRoVXJsIjoiaHR0cHM6Ly9hdXRoLmV4YW1wbGUuY29tIn0="
 * ```
 */
declare function encodePublishableKey(authUrl: string, opts?: {
    mode?: "live" | "test";
    appId?: string;
}): string;
interface DecodedKey {
    authUrl: string;
    appId: string | undefined;
    mode: "live" | "test";
}
/**
 * Decodes a publishable key back to its constituent parts.
 *
 * @throws {Error} If the key is malformed or has an unknown payload version.
 */
declare function decodePublishableKey(key: string): DecodedKey;

/**
 * Webhook signature verification utility.
 *
 * kova-auth signs all outbound webhook payloads with HMAC-SHA256 using the
 * endpoint's secret. The signature is sent in the `X-Kova-Auth-Signature`
 * header as `sha256=<hex>`.
 *
 * Use this helper in your webhook receiver to verify that payloads genuinely
 * came from kova-auth and have not been tampered with.
 *
 * @example
 * ```ts
 * // Next.js App Router route handler
 * import { verifyWebhookSignature } from "@kova/react/webhook";
 *
 * export async function POST(req: Request) {
 *   const rawBody = await req.text();
 *   const signature = req.headers.get("x-kova-auth-signature") ?? "";
 *   const secret = process.env.KOVA_AUTH_WEBHOOK_SECRET!;
 *
 *   if (!verifyWebhookSignature(rawBody, signature, secret)) {
 *     return new Response("Invalid signature", { status: 401 });
 *   }
 *
 *   const event = JSON.parse(rawBody);
 *   // handle event...
 *   return new Response("OK");
 * }
 * ```
 *
 * @example
 * ```ts
 * // Express / Node.js
 * import express from "express";
 * import { verifyWebhookSignature } from "@kova/react";
 *
 * app.post("/webhooks/kova-auth", express.raw({ type: "application/json" }), (req, res) => {
 *   const rawBody = req.body.toString("utf-8");
 *   const signature = req.headers["x-kova-auth-signature"] ?? "";
 *   if (!verifyWebhookSignature(rawBody, signature, process.env.KOVA_AUTH_WEBHOOK_SECRET!)) {
 *     return res.status(401).json({ error: "Invalid signature" });
 *   }
 *   // handle event...
 *   res.json({ received: true });
 * });
 * ```
 */
interface VerifyOptions {
    /**
     * Maximum age of the webhook payload in seconds.
     * When set, the `X-Kova-Auth-Signature` header must include a `t=<timestamp>`
     * component and the payload must not be older than this many seconds.
     *
     * @example 300 (5 minutes — recommended for production)
     */
    maxAgeSeconds?: number;
}
interface WebhookEvent<T = unknown> {
    /** Event type, e.g. `"user.signIn"`, `"apiKey.created"`. */
    event: string;
    /** Unix millisecond timestamp when the event was emitted. */
    timestamp: number;
    /** Event-specific payload. */
    data: T;
}
/**
 * Verifies that an inbound webhook payload's HMAC-SHA256 signature matches
 * what kova-auth would have generated with the given secret.
 *
 * Works in both Node.js (via `crypto`) and Web/Edge environments (via
 * `SubtleCrypto` / `globalThis.crypto`).
 *
 * @param rawBody   - Raw request body as a string (before `JSON.parse`)
 * @param signature - The `X-Kova-Auth-Signature` header value
 * @param secret    - The webhook endpoint's signing secret (from creation response)
 * @param options   - Optional timestamp tolerance configuration
 * @returns `true` when the signature is valid (and not expired if `maxAgeSeconds` set)
 */
declare function verifyWebhookSignature(rawBody: string, signature: string, secret: string, options?: VerifyOptions): Promise<boolean>;

export { type Appearance, type AppearanceElements, type AppearanceVariables, type ClientOptions, ConnectedAccounts, type DecodedKey, type KovaAuthClient, type KovaAuthConfig, KovaAuthProvider, type KovaAuthProviderProps, type KovaMembership, type KovaOrganization, type KovaSession, type KovaUser, type LinkedAccount, type OAuthProvider, OrgSwitcher, type OrgSwitcherProps, type PluginConfig, Protect, type ProtectProps, SignIn, type SignInProps, type SignInTab, SignUp, type SignUpProps, type UseAuthReturn, type UseLinkedAccountsReturn, type UseOrganizationReturn, type UseRateLimitReturn, type UseSessionReturn, type UseSignInReturn, type UseSignUpReturn, type UseUserReturn, UserButton, type UserButtonProps, type VerifyOptions, type WebhookEvent, createKovaAuthClient, decodePublishableKey, encodePublishableKey, extractRetryAfter, rateLimitMessage, useAuth, useKovaAuth, useLinkedAccounts, useOrganization, useRateLimit, useSession, useSignIn, useSignUp, useUser, verifyWebhookSignature };
