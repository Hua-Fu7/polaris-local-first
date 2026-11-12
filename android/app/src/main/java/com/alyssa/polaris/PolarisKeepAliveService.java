package com.alyssa.polaris;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

import androidx.annotation.Nullable;

/**
 * 主动消息后台保活服务。
 *
 * 主动消息的真正正文需要在 WebView（App 进程）里调用大模型生成。国产 ROM（vivo/OPPO/ColorOS）
 * 会在 App 退到后台 / 锁屏一段时间后冻结甚至杀掉进程，导致"到点生成"被掐断，只能等用户点开 App 才补上。
 *
 * 这个服务用两个手段尽量延长进程存活窗口：
 * 1. 前台服务（startForeground）——告诉系统"我在干正事，别杀我"，是最可靠的本地保活手段；
 * 2. 部分唤醒锁（PARTIAL_WAKE_LOCK）——让 CPU 在锁屏后仍能短暂工作，给生成链争取时间。
 *
 * 它不负责"到点生成"本身（那是前端 + 原生闹钟的职责），只负责"到点那一刻，进程还活着、CPU 还醒着"。
 * 注意：厂商 ROM 的省电白名单仍可能强行终止本服务，这是系统层面的硬限制，无法在纯本地架构下根除。
 */
public class PolarisKeepAliveService extends Service {

    private static final String CHANNEL_ID = "polaris-keepalive";
    private static final int NOTIFICATION_ID = 500_000;

    private PowerManager.WakeLock wakeLock;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        startInForeground();
        acquireWakeLock();
        // 后台保活服务不需要粘性重启；一旦被杀就顺其自然，等下一次闹钟 / 用户打开 App 再兜底。
        return START_NOT_STICKY;
    }

    private void startInForeground() {
        ensureChannel();
        Notification notification = buildNotification();
        try {
            startForeground(NOTIFICATION_ID, notification);
        } catch (SecurityException ignored) {
            // 通知权限被收回时，前台服务启动失败；此时退回普通服务，仍尽力保持进程存活。
        }
    }

    private void ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        NotificationChannel channel = manager.getNotificationChannel(CHANNEL_ID);
        if (channel == null) {
            channel = new NotificationChannel(
                CHANNEL_ID,
                "后台运行",
                NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("保持主动消息在后台按点生成。");
            channel.setShowBadge(false);
            manager.createNotificationChannel(channel);
        }
    }

    private Notification buildNotification() {
        Intent tapIntent = new Intent(this, MainActivity.class);
        tapIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent contentIntent = PendingIntent.getActivity(
            this,
            0,
            tapIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Notification.Builder builder;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            builder = new Notification.Builder(this, CHANNEL_ID);
        } else {
            builder = new Notification.Builder(this);
        }
        builder.setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle("Polaris 正在运行")
            .setContentText("保持主动消息在后台按点生成")
            .setOngoing(true)
            .setContentIntent(contentIntent);

        return builder.build();
    }

    private void acquireWakeLock() {
        try {
            if (wakeLock == null) {
                PowerManager powerManager = (PowerManager) getSystemService(Context.POWER_SERVICE);
                if (powerManager != null) {
                    wakeLock = powerManager.newWakeLock(
                        PowerManager.PARTIAL_WAKE_LOCK,
                        "polaris:proactive-keepalive"
                    );
                    wakeLock.setReferenceCounted(false);
                }
            }
            if (wakeLock != null && !wakeLock.isHeld()) {
                // 只短暂持有（5 分钟），足够生成链跑完，又不至于把电池耗光。
                wakeLock.acquire(5 * 60 * 1000L);
            }
        } catch (RuntimeException ignored) {
            // 个别 ROM 对唤醒锁有额外限制，失败不影响保活主路径。
        }
    }

    @Override
    public void onDestroy() {
        if (wakeLock != null && wakeLock.isHeld()) {
            try {
                wakeLock.release();
            } catch (RuntimeException ignored) {
            }
            wakeLock = null;
        }
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
