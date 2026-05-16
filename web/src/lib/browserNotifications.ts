import type { MessageRecord } from '../types';
import { buildWorkspacePath } from './workspaceRoute';

const PUSH_ENABLED_KEY = 'zouk_push_notifications_enabled';
const NOTIFICATIONS_ENABLED_KEY = 'zouk_notifications_enabled';

function getWindow(): Window | null {
  return typeof window === 'undefined' ? null : window;
}

export function notificationPermission(): NotificationPermission | 'unsupported' {
  const win = getWindow();
  if (!win || !('Notification' in win)) return 'unsupported';
  return Notification.permission;
}

export function supportsPushNotifications(): boolean {
  const win = getWindow();
  return !!win && 'serviceWorker' in navigator && 'PushManager' in win && notificationPermission() !== 'unsupported';
}

export function localPushEnabled(): boolean {
  try {
    return localStorage.getItem(PUSH_ENABLED_KEY) === '1';
  } catch {
    return false;
  }
}

export function notificationsEnabled(): boolean {
  try {
    return localStorage.getItem(NOTIFICATIONS_ENABLED_KEY) === '1';
  } catch {
    return false;
  }
}

export function setNotificationsEnabled(enabled: boolean) {
  try {
    if (enabled) localStorage.setItem(NOTIFICATIONS_ENABLED_KEY, '1');
    else localStorage.removeItem(NOTIFICATIONS_ENABLED_KEY);
  } catch {
    // ignore private-mode storage failures
  }
}

export function setLocalPushEnabled(enabled: boolean) {
  try {
    if (enabled) localStorage.setItem(PUSH_ENABLED_KEY, '1');
    else localStorage.removeItem(PUSH_ENABLED_KEY);
  } catch {
    // ignore private-mode storage failures
  }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export async function ensureNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  const permission = notificationPermission();
  if (permission !== 'default') return permission;
  return Notification.requestPermission();
}

export async function getCurrentPushSubscription(): Promise<PushSubscription | null> {
  if (!supportsPushNotifications()) return null;
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

export async function subscribeBrowserPush(publicKey: string): Promise<PushSubscriptionJSON | null> {
  if (!supportsPushNotifications()) return null;
  const permission = await ensureNotificationPermission();
  if (permission !== 'granted') return null;

  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  const subscription = existing || await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey) as unknown as BufferSource,
  });
  setLocalPushEnabled(true);
  return subscription.toJSON();
}

export async function unsubscribeBrowserPush(): Promise<string | null> {
  const subscription = await getCurrentPushSubscription();
  if (!subscription) {
    setLocalPushEnabled(false);
    return null;
  }
  const endpoint = subscription.endpoint;
  await subscription.unsubscribe().catch(() => false);
  setLocalPushEnabled(false);
  return endpoint;
}

function stripBody(content: string | undefined, maxLength = 160) {
  const text = String(content || '')
    .replace(/```[\s\S]*?```/g, '[code]')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= maxLength) return text || 'New message';
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function normalizeName(value: string | undefined) {
  return String(value || '').trim().toLowerCase();
}

function dmParties(message: MessageRecord) {
  if (message.dm_parties && message.dm_parties.length > 0) return message.dm_parties;
  if (message.channel_name.startsWith('dm:')) return message.channel_name.substring(3).split(',');
  return [];
}

function mentionsCurrentUser(message: MessageRecord, currentUser: string) {
  const normalized = normalizeName(currentUser);
  if (!normalized) return false;
  const aliases = new Set([normalized, normalized.replace(/\s+/g, '_')]);
  const regex = /@([\p{L}\p{N}_-]+)/gu;
  let match;
  while ((match = regex.exec(message.content || '')) !== null) {
    if (aliases.has(normalizeName(match[1]))) return true;
  }
  return false;
}

function messageWouldReceiveServerPush(message: MessageRecord, currentUser: string) {
  const isDm = message.channel_type === 'dm' || message.parent_channel_type === 'dm';
  if (isDm && dmParties(message).some(p => normalizeName(p) === normalizeName(currentUser))) return true;
  return mentionsCurrentUser(message, currentUser);
}

export function shouldShowLocalNotification(message: MessageRecord, currentUser: string, conversationFocused: boolean): boolean {
  if (!notificationsEnabled()) return false;
  if (message.sender_name === currentUser) return false;
  if (message.sender_type === 'system') return false;
  const docHidden = document.visibilityState === 'hidden' || !document.hasFocus();
  if (!docHidden) return false;
  void conversationFocused;
  // When server push is enabled for this message category, avoid showing a
  // duplicate foreground notification on browsers that fire both WS and push.
  if (localPushEnabled() && messageWouldReceiveServerPush(message, currentUser)) return false;
  return true;
}

export async function showMessageNotification(
  message: MessageRecord,
  currentUser: string,
  workspaceId: string,
  channelLabel: string,
): Promise<void> {
  void currentUser;
  if (notificationPermission() !== 'granted') return;
  const title = `${message.sender_name || 'Zouk'} · ${channelLabel}`;
  const options: NotificationOptions = {
    body: stripBody(message.content),
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: `zouk:${workspaceId}:${message.channelId || message.channel_name}`,
    data: { url: buildWorkspacePath(workspaceId), messageId: message.id },
  };

  try {
    const registration = await Promise.race<ServiceWorkerRegistration | null>([
      navigator.serviceWorker?.ready ?? Promise.resolve(null),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 800)),
    ]);
    if (registration?.showNotification) {
      await registration.showNotification(title, options);
      return;
    }
  } catch {
    // fall through to the page-level Notification constructor
  }

  new Notification(title, options);
}
