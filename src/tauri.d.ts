// ── Tauri Plugin Shims ──────────────────────────────────────────────────
// These are used by desktop components but might not be installed in the root
// project dependencies if it's primarily a web build environment.

declare module "@tauri-apps/plugin-updater" {
  export interface Update {
    version: string;
    body: string;
    date: string | null;
    downloadAndInstall(): Promise<void>;
  }
  export function check(): Promise<Update | null>;
  export function onUpdaterEvent(cb: (event: any) => void): Promise<() => void>;
}

declare module "@tauri-apps/plugin-process" {
  export function relaunch(): Promise<void>;
  export function exit(code?: number): Promise<void>;
}

declare module "@tauri-apps/plugin-autostart" {
  export function enable(): Promise<void>;
  export function disable(): Promise<void>;
  export function isEnabled(): Promise<boolean>;
}

declare module "@tauri-apps/plugin-notification" {
  export interface Attachment {
    id: string;
    url: string;
  }

  export interface NotificationOptions {
    id?: number;
    channelId?: string;
    title: string;
    body?: string;
    largeBody?: string;
    summary?: string;
    actionTypeId?: string;
    group?: string;
    groupSummary?: boolean;
    sound?: string;
    inboxLines?: string[];
    icon?: string;
    largeIcon?: string;
    iconColor?: string;
    attachments?: Attachment[];
    extra?: Record<string, unknown>;
    ongoing?: boolean;
    autoCancel?: boolean;
    silent?: boolean;
    visibility?: number;
    number?: number;
  }

  export interface NotificationAction {
    id: string;
    title: string;
    requiresAuthentication?: boolean;
    foreground?: boolean;
    destructive?: boolean;
    input?: boolean;
    inputButtonTitle?: string;
    inputPlaceholder?: string;
  }

  export interface NotificationActionType {
    id: string;
    actions: NotificationAction[];
    hiddenPreviewsBodyPlaceholder?: string;
    customDismissAction?: boolean;
    allowInCarPlay?: boolean;
    hiddenPreviewsShowTitle?: boolean;
    hiddenPreviewsShowSubtitle?: boolean;
  }

  export interface NotificationActionEvent {
    actionId?: string | null;
    inputValue?: string | null;
    notification?: NotificationOptions | null;
  }

  export interface NotificationChannel {
    id: string;
    name: string;
    description?: string;
    sound?: string;
    lights?: boolean;
    lightColor?: string;
    vibration?: boolean;
    importance?: number;
    visibility?: number;
  }

  export enum Importance {
    None,
    Min,
    Low,
    Default,
    High,
  }

  export enum Visibility {
    Secret = -1,
    Private = 0,
    Public = 1,
  }

  export function isPermissionGranted(): Promise<boolean>;
  export function requestPermission(): Promise<NotificationPermission>;
  export function sendNotification(options: NotificationOptions | string): void;
  export function registerActionTypes(types: NotificationActionType[]): Promise<void>;
  export function createChannel(channel: NotificationChannel): Promise<void>;
  export function channels(): Promise<NotificationChannel[]>;
  export function onAction(cb: (notification: NotificationActionEvent) => void): Promise<() => void>;
}
