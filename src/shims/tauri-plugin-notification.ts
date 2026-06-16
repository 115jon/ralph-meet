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

export interface NotificationActionEvent {
  actionId?: string | null;
  inputValue?: string | null;
  notification?: NotificationOptions | null;
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

export async function isPermissionGranted() {
  return false;
}

export async function requestPermission(): Promise<NotificationPermission> {
  return "denied";
}

export function sendNotification(_options: NotificationOptions | string) {}

export async function registerActionTypes(_types: NotificationActionType[]) {}

export async function createChannel(_channel: NotificationChannel) {}

export async function channels(): Promise<NotificationChannel[]> {
  return [];
}

export async function onAction(_cb: (notification: NotificationActionEvent) => void): Promise<() => void> {
  return async () => {};
}
