package com.alyssa.polaris;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;

/**
 * 主动消息精确闹钟的唤醒接收器。
 *
 * 系统在锁屏 / Doze 状态下也会拉起这个 Receiver（AlarmManager 的 RTC_WAKEUP + setExactAndAllowWhileIdle）。
 * 它做两件事：
 * 1. 立即发一条占位通知，保证锁屏上立刻能看到"有人想找你"（不依赖 WebView / JS）；
 * 2. 发一个应用内广播，让已复活的 JS 侧收到后跑真正的生成逻辑，生成完成后再用真实回复替换占位通知。
 *
 * 注意：这里是"尽力而为"的唤醒。即便精确闹钟已授权，OPPO/ColorOS 等厂商 ROM 仍可能在
 * 用户未开启"自启动 / 后台运行 / 省电无限制"时，在 Receiver 返回后立即回收进程，导致 JS
 * 来不及生成真实内容。此时锁屏上仍会保留占位通知，用户点击进入 App 后由既有链路兜底生成。
 */
public class PolarisTriggerAlarmReceiver extends BroadcastReceiver {

    public static final String ACTION_TRIGGER_FIRED = "com.alyssa.polaris.action.POLARIS_TRIGGER_FIRED";
    private static final String EXTRA_RULE_ID = "ruleId";
    private static final String EXTRA_TITLE = "title";
    private static final String EXTRA_BODY = "body";
    private static final String EXTRA_SCHEDULED_FOR = "scheduledFor";

    private static final String NOTIFICATION_CHANNEL_ID = "polaris-triggers";
    private static final int NOTIFICATION_ID_BASE = 100_000;

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        String ruleId = intent.getStringExtra(EXTRA_RULE_ID);
        String title = intent.getStringExtra(EXTRA_TITLE);
        String body = intent.getStringExtra(EXTRA_BODY);
        long scheduledFor = intent.getLongExtra(EXTRA_SCHEDULED_FOR, 0L);
        if (ruleId == null || ruleId.isEmpty()) return;

        // 先拉起前台服务 + 唤醒锁，让 App 进程在闹钟到点后不被立刻冻结，
        // 给 JS 侧的"决策层 + 生成真实正文"争取足够的时间跑完。
        startKeepAlive(context);
        postPlaceholderNotification(context, ruleId, title, body, scheduledFor);
        broadcastTriggerFired(context, ruleId, scheduledFor);
    }

    /**
     * 启动前台保活服务，并短暂持有唤醒锁，让 CPU 在锁屏后仍能工作一小段，
     * 覆盖"闹钟到点 → WebView 醒来 → 调模型生成正文"这条链。
     */
    private void startKeepAlive(Context context) {
        try {
            Intent serviceIntent = new Intent(context, PolarisKeepAliveService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(serviceIntent);
            } else {
                context.startService(serviceIntent);
            }
        } catch (RuntimeException ignored) {
            // 个别 ROM 限制后台启动前台服务，失败则退回纯广播唤醒，由 App 打开时兜底。
        }
    }

    private void postPlaceholderNotification(
        Context context,
        String ruleId,
        String title,
        String body,
        long scheduledFor
    ) {
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;

        ensureChannel(manager);

        Intent tapIntent = new Intent(context, MainActivity.class);
        tapIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        tapIntent.putExtra("polarisTriggerRuleId", ruleId);
        tapIntent.putExtra("polarisTriggerScheduledFor", scheduledFor);

        PendingIntent contentIntent = PendingIntent.getActivity(
            context,
            (int) (resolveNotificationId(ruleId) & 0x7fffffff),
            tapIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Notification.Builder builder;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            builder = new Notification.Builder(context, NOTIFICATION_CHANNEL_ID);
        } else {
            builder = new Notification.Builder(context);
        }
        builder.setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title == null || title.isEmpty() ? "Polaris" : title)
            .setContentText(body == null || body.isEmpty() ? "点开看看 TA 想说什么" : body)
            .setAutoCancel(true)
            .setContentIntent(contentIntent);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
            && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
            return;
        }
        try {
            manager.notify((int) resolveNotificationId(ruleId), builder.build());
        } catch (SecurityException ignored) {
            // 通知权限被系统收回时静默失败，等待 JS 侧兜底。
        }
    }

    private void broadcastTriggerFired(Context context, String ruleId, long scheduledFor) {
        Intent wakeIntent = new Intent(ACTION_TRIGGER_FIRED);
        wakeIntent.setPackage(context.getPackageName());
        wakeIntent.putExtra(EXTRA_RULE_ID, ruleId);
        wakeIntent.putExtra(EXTRA_SCHEDULED_FOR, scheduledFor);
        context.sendBroadcast(wakeIntent);
    }

    private void ensureChannel(NotificationManager manager) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = manager.getNotificationChannel(NOTIFICATION_CHANNEL_ID);
        if (channel == null) {
            channel = new NotificationChannel(
                NOTIFICATION_CHANNEL_ID,
                "主动消息",
                NotificationManager.IMPORTANCE_HIGH
            );
            channel.setDescription("协作者按时间主动找你时显示。");
            manager.createNotificationChannel(channel);
        }
    }

    private static long resolveNotificationId(String ruleId) {
        long hash = 0;
        for (int index = 0; index < ruleId.length(); index += 1) {
            hash = (hash * 31 + ruleId.charAt(index)) & 0xffffffffL;
        }
        return NOTIFICATION_ID_BASE + (hash % 1_900_000_000L);
    }
}
