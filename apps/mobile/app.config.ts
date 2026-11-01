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

const appVariant = resolveVariant(process.env.APP_VARIANT);
const variant = VARIANTS[appVariant];

// Firebase (FCM) config for all three package names. It is not committed: CI
// and EAS point GOOGLE_SERVICES_JSON at it, local builds copy it here
// (gitignored).
const googleServicesFile =
  process.env.GOOGLE_SERVICES_JSON ?? "./google-services.json";

// Release versioning. The release workflow derives both from a `mobile-vX.Y.Z`
// tag: RALPH_APP_VERSION=X.Y.Z and RALPH_VERSION_CODE=X*10000+Y*100+Z, which
// rises with every semver bump while minor and patch stay below 100. Local
// builds fall back to the defaults.
const appVersion = process.env.RALPH_APP_VERSION ?? "0.1.0";
const versionCode = Number.parseInt(process.env.RALPH_VERSION_CODE ?? "1", 10);

const MICROPHONE_USAGE = "Ralph Meet uses the microphone in voice channels.";
const CAMERA_USAGE = "Ralph Meet uses the camera for video in voice channels.";

// Mirrors the web app's VITE_API_BASE_URL, VITE_KOVA_AUTH_URL and
// VITE_KOVA_AUTH_PUBLISHABLE_KEY. All defaults come from the web
// app's dependency-free src/lib/site-defaults.ts; the publishable key is
// public by design.
const apiBaseUrl =
  process.env.EXPO_PUBLIC_RALPH_API_URL ?? DEFAULT_PUBLIC_WEB_URL;
// The public web app: invite and message links point here, and Android opens
// them in the app (App Links, verified by the Worker's assetlinks.json).
const webUrl = process.env.EXPO_PUBLIC_RALPH_WEB_URL ?? DEFAULT_PUBLIC_WEB_URL;
const webHost = new URL(webUrl).host;
const kovaAuthUrl =
  process.env.EXPO_PUBLIC_KOVA_AUTH_URL ?? DEFAULT_KOVA_AUTH_URL;
const kovaPublishableKey =
  process.env.EXPO_PUBLIC_KOVA_PUBLISHABLE_KEY ??
  DEFAULT_KOVA_AUTH_PUBLISHABLE_KEY;

const config: ExpoConfig = {
  name: variant.name,
  slug: "ralph-meet",
  version: appVersion,
  scheme: variant.scheme,
  platforms: ["android", "ios"],
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "automatic",
  // SDK 58: the new architecture, edge-to-edge and Hermes are always on, so
  // they have no config keys.
  android: {
    package: variant.package,
    versionCode,
    googleServicesFile,
    predictiveBackGestureEnabled: true,
    // Voice: the microphone, the camera and call audio routing. The
    // background call's foreground service (incl. screen sharing's
    // mediaProjection type), notification, Telecom and Bluetooth permissions
    // come from modules/ralph-call's own AndroidManifest.xml.
    permissions: [
      "android.permission.INTERNET",
      "android.permission.RECORD_AUDIO",
      "android.permission.CAMERA",
      "android.permission.MODIFY_AUDIO_SETTINGS",
      "android.permission.POST_NOTIFICATIONS",
    ],
    // Invite and message links on the web host open here once Android has
    // verified /.well-known/assetlinks.json; the scheme stays the fallback.
    intentFilters: [
      {
        action: "VIEW",
        autoVerify: true,
        category: ["BROWSABLE", "DEFAULT"],
        data: [
          { scheme: "https", host: webHost, pathPrefix: "/invite/" },
          { scheme: "https", host: webHost, pathPrefix: "/chat/" },
        ],
      },
    ],
    // The WebRTC plugin also asks for an overlay; nothing draws over apps.
    blockedPermissions: ["android.permission.SYSTEM_ALERT_WINDOW"],
    adaptiveIcon: {
      foregroundImage: "./assets/icon.png",
      backgroundColor: "#000000",
    },
  },
  plugins: [
    "expo-router",
    "expo-secure-store",
    "expo-web-browser",
    "expo-image",
    // Chat GIFs and videos play inline only, never in the background or PiP.
    // The activity supports PiP for the call screen's video (ralph-call's
    // CallPip arms it only while a camera or a share is on screen).
    [
      "expo-video",
      { supportsBackgroundPlayback: false, supportsPictureInPicture: true },
    ],
    // Message pushes are drawn by modules/ralph-notify on its own channels
    // (Direct messages, Mentions and replies, Other), calls by
    // modules/ralph-call (Incoming calls, Missed calls); anything FCM draws
    // itself lands on Other.
    ["expo-notifications", { defaultChannel: "other" }],
    // Photos, videos, text and links shared from other apps open a "Send
    // to…" picker. Android only for now: iOS needs a share extension target.
    [
      "expo-share-intent",
      {
        androidIntentFilters: ["text/*", "image/*", "video/*"],
        androidMultiIntentFilters: ["image/*", "video/*"],
        disableIOS: true,
      },
    ],
    // The attach tray's recent-media grid reads photos and videos only
    // (READ_MEDIA_IMAGES / READ_MEDIA_VIDEO, plus Android 14's
    // READ_MEDIA_VISUAL_USER_SELECTED for "Select photos"); it never writes.
    [
      "expo-media-library",
      {
        photosPermission:
          "Ralph Meet shows your recent photos and videos so you can attach them.",
        savePhotosPermission: false,
        granularPermissions: ["photo", "video"],
      },
    ],
    // The tray's camera tile and Photos key (the system photo picker). Camera
    // and microphone are also voice's: set, not false, since false would
    // block the permission for the whole app.
    [
      "expo-image-picker",
      {
        cameraPermission: CAMERA_USAGE,
        microphonePermission: MICROPHONE_USAGE,
      },
    ],
    [
      "@config-plugins/react-native-webrtc",
      {
        cameraPermission: CAMERA_USAGE,
        microphonePermission: MICROPHONE_USAGE,
      },
    ],
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
    [
      "expo-build-properties",
      {
        android: {
          minSdkVersion: 24,
          // Release builds run R8. WebRTC reaches its classes from native
          // code (JNI), and libwebrtc references an optional Dav1d decoder
          // that the Android build does not ship.
          extraProguardRules:
            "-keep class org.webrtc.** { *; }\n-dontwarn org.webrtc.Dav1dDecoder$Natives",
        },
      },
    ],
    "./plugins/withAndroidGradleHeap.cjs",
    "./plugins/withAndroidPredictiveBackCompat.cjs",
    "./plugins/withReleaseSigning.cjs",
  ],
  experiments: { typedRoutes: true },
  extra: {
    apiBaseUrl,
    webUrl,
    kovaAuthUrl,
    kovaPublishableKey,
    appVariant,
  },
};

export default config;
