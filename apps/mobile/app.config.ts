import type { ExpoConfig } from "expo/config";

import {
  DEFAULT_KOVA_AUTH_PUBLISHABLE_KEY,
  DEFAULT_KOVA_AUTH_URL,
  DEFAULT_PUBLIC_WEB_URL,
} from "../../src/lib/site-defaults.ts";

type AppVariant = "development" | "preview" | "production";

const VARIANTS = {
  development: {
    name: "Ralph Meet Dev",
    package: "dev.jontitor.ralphmeet.dev",
    scheme: "ralphmeet-dev",
  },
  preview: {
    name: "Ralph Meet Preview",
    package: "dev.jontitor.ralphmeet.preview",
    scheme: "ralphmeet-preview",
  },
  production: {
    name: "Ralph Meet",
    package: "dev.jontitor.ralphmeet",
    scheme: "ralphmeet",
  },
} as const satisfies Record<
  AppVariant,
  { name: string; package: string; scheme: string }
>;

function resolveVariant(value: string | undefined): AppVariant {
  return value === "development" || value === "preview" ? value : "production";
}

const variant = VARIANTS[resolveVariant(process.env.APP_VARIANT)];

// Mirrors the web app's VITE_API_BASE_URL, VITE_KOVA_AUTH_URL and
// VITE_KOVA_AUTH_PUBLISHABLE_KEY. All defaults come from the web
// app's dependency-free src/lib/site-defaults.ts; the publishable key is
// public by design.
const apiBaseUrl =
  process.env.EXPO_PUBLIC_RALPH_API_URL ?? DEFAULT_PUBLIC_WEB_URL;
const kovaAuthUrl =
  process.env.EXPO_PUBLIC_KOVA_AUTH_URL ?? DEFAULT_KOVA_AUTH_URL;
const kovaPublishableKey =
  process.env.EXPO_PUBLIC_KOVA_PUBLISHABLE_KEY ??
  DEFAULT_KOVA_AUTH_PUBLISHABLE_KEY;

const config: ExpoConfig = {
  name: variant.name,
  slug: "ralph-meet",
  version: "0.1.0",
  scheme: variant.scheme,
  platforms: ["android", "ios"],
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "automatic",
  // SDK 58: the new architecture, edge-to-edge and Hermes are always on, so
  // they have no config keys.
  android: {
    package: variant.package,
    predictiveBackGestureEnabled: true,
    permissions: ["android.permission.INTERNET"],
    adaptiveIcon: {
      foregroundImage: "./assets/icon.png",
      backgroundColor: "#000000",
    },
  },
  plugins: [
    "expo-router",
    "expo-secure-store",
    "expo-web-browser",
    [
      "expo-splash-screen",
      {
        image: "./assets/icon.png",
        imageWidth: 200,
        resizeMode: "contain",
        backgroundColor: "#f4f4f5",
        dark: { image: "./assets/icon.png", backgroundColor: "#000000" },
      },
    ],
    ["expo-build-properties", { android: { minSdkVersion: 24 } }],
    "./plugins/withAndroidGradleHeap.cjs",
    "./plugins/withAndroidPredictiveBackCompat.cjs",
  ],
  experiments: { typedRoutes: true },
  extra: { apiBaseUrl, kovaAuthUrl, kovaPublishableKey },
};

export default config;
