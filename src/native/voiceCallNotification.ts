import { Capacitor } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import type {
  ActionPerformed,
  DeliveredNotificationSchema,
  LocalNotificationSchema
} from '@capacitor/local-notifications';

/**
 * 「协作者打给你，但你不在北极星里」时的落地方式：一条本地通知。
 *
 * 用户明确要求不要震动、不要响铃，所以这里的通道用低重要级（IMPORTANCE_LOW
 * 在系统里就是「不发声」）并且显式关掉振动；通知本体也不带 sound。
 * 点它进 App 之后由 `consumeDeliveredVoiceCallTaps` / 点击监听把它交回给通话界面。
 */

const POLARIS_VOICE_CALL_NOTIFICATION_KIND = 'polaris-voice-call-v1';
const POLARIS_VOICE_CALL_NOTIFICATION_CHANNEL_ID = 'polaris-voice-calls-v1';
const VOICE_CALL_NOTIFICATION_ID_BASE = 2_100_000_000;
const VOICE_CALL_NOTIFICATION_ID_SPAN = 30_000_000;

export type NativeVoiceCallNotificationResult = 'unavailable' | 'denied' | 'posted' | 'failed';

export type NativeVoiceCallTap = {
  collaboratorId: string;
  collaboratorName: string;
  conversationId: string;
  reason: string;
  createdAt: number;
};

type NativeVoiceCallNotificationExtra = {
  polarisKind: typeof POLARIS_VOICE_CALL_NOTIFICATION_KIND;
  collaboratorId: string;
  collaboratorName: string;
  conversationId: string;
  reason: string;
  createdAt: number;
};

function canUseLocalNotifications() {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('LocalNotifications');
}

function shouldUseAndroidNotificationChannel() {
  return canUseLocalNotifications() && Capacitor.getPlatform() === 'android';
}

export function resolveVoiceCallNotificationId(conversationId: string) {
  let hash = 0;
  for (let index = 0; index < conversationId.length; index += 1) {
    hash = (hash * 31 + conversationId.charCodeAt(index)) | 0;
  }
  return VOICE_CALL_NOTIFICATION_ID_BASE + (Math.abs(hash) % VOICE_CALL_NOTIFICATION_ID_SPAN);
}

function isVoiceCallNotificationExtra(value: unknown): value is NativeVoiceCallNotificationExtra {
  if (!value || typeof value !== 'object') return false;
  const extra = value as Partial<NativeVoiceCallNotificationExtra>;
  return extra.polarisKind === POLARIS_VOICE_CALL_NOTIFICATION_KIND
    && typeof extra.collaboratorId === 'string'
    && typeof extra.conversationId === 'string';
}

function normalizeTap(extra: NativeVoiceCallNotificationExtra): NativeVoiceCallTap {
  return {
    collaboratorId: extra.collaboratorId,
    collaboratorName: typeof extra.collaboratorName === 'string' ? extra.collaboratorName : '',
    conversationId: extra.conversationId,
    reason: typeof extra.reason === 'string' ? extra.reason : '',
    createdAt: typeof extra.createdAt === 'number' ? extra.createdAt : 0
  };
}

export function buildVoiceCallNotification(input: {
  collaboratorName: string;
  body: string;
  extra: NativeVoiceCallNotificationExtra;
  id: number;
}): LocalNotificationSchema {
  return {
    id: input.id,
    title: input.collaboratorName,
    body: input.body,
    ...(shouldUseAndroidNotificationChannel()
      ? { channelId: POLARIS_VOICE_CALL_NOTIFICATION_CHANNEL_ID }
      : {}),
    extra: input.extra,
    autoCancel: true,
    threadIdentifier: 'polaris-voice-calls',
    group: 'polaris-voice-calls'
  };
}

/**
 * 声音与振动都关掉。IMPORTANCE_LOW（2）在 Android 上就是不发声的那一档，
 * 通道一旦建过就改不了，所以参数必须一次定死。
 */
async function ensureVoiceCallNotificationChannel() {
  if (!shouldUseAndroidNotificationChannel()) return;
  await LocalNotifications.createChannel({
    id: POLARIS_VOICE_CALL_NOTIFICATION_CHANNEL_ID,
    name: '来电',
    description: '协作者想跟你通话时显示，不响铃、不震动。',
    importance: 2,
    visibility: 1,
    vibration: false
  });
}

export async function postNativeVoiceCallNotification(input: {
  collaboratorId: string;
  collaboratorName: string;
  conversationId: string;
  reason: string;
  body: string;
  createdAt?: number;
}): Promise<NativeVoiceCallNotificationResult> {
  if (!canUseLocalNotifications()) return 'unavailable';

  try {
    const permission = await LocalNotifications.checkPermissions();
    if (permission.display !== 'granted') return 'denied';

    await ensureVoiceCallNotificationChannel();
    const createdAt = input.createdAt ?? Date.now();
    await LocalNotifications.schedule({
      notifications: [buildVoiceCallNotification({
        id: resolveVoiceCallNotificationId(input.conversationId),
        collaboratorName: input.collaboratorName,
        body: input.body,
        extra: {
          polarisKind: POLARIS_VOICE_CALL_NOTIFICATION_KIND,
          collaboratorId: input.collaboratorId,
          collaboratorName: input.collaboratorName,
          conversationId: input.conversationId,
          reason: input.reason,
          createdAt
        }
      })]
    });
    return 'posted';
  } catch {
    return 'failed';
  }
}

export function extractNativeVoiceCallTap(action: ActionPerformed): NativeVoiceCallTap | null {
  const extra = action.notification.extra;
  if (!isVoiceCallNotificationExtra(extra)) return null;
  return normalizeTap(extra);
}

function extractDeliveredVoiceCallTap(
  notification: DeliveredNotificationSchema
): NativeVoiceCallTap | null {
  const extra = notification.extra;
  if (!isVoiceCallNotificationExtra(extra)) return null;
  return normalizeTap(extra);
}

/**
 * 点通知把 App 拉起来时，点击事件可能发生在监听器注册之前，
 * 所以启动后还要把投递箱里那条掏出来补处理一次。
 */
export async function consumeDeliveredVoiceCallTaps(): Promise<NativeVoiceCallTap[]> {
  if (!canUseLocalNotifications()) return [];

  try {
    const delivered = await LocalNotifications.getDeliveredNotifications();
    const notifications = delivered.notifications.filter((notification) =>
      isVoiceCallNotificationExtra(notification.extra)
    );
    if (notifications.length === 0) return [];

    await LocalNotifications.removeDeliveredNotifications({ notifications });
    return notifications
      .map((notification) => extractDeliveredVoiceCallTap(notification))
      .filter((tap): tap is NativeVoiceCallTap => Boolean(tap));
  } catch {
    return [];
  }
}

export async function registerNativeVoiceCallTapListener(
  onTap: (tap: NativeVoiceCallTap) => void
): Promise<PluginListenerHandle | null> {
  if (!canUseLocalNotifications()) return null;

  return LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
    const tap = extractNativeVoiceCallTap(action);
    if (tap) onTap(tap);
  });
}
