package com.alyssa.polaris;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.os.Build;
import android.provider.Settings;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * 把主动消息规则交给 Android 原生 AlarmManager 排精确闹钟。
 *
 * 前端的 JS 定时器在 App 被系统冻结 / 杀掉后不会执行，锁屏时主动消息因此"到点了也不生成"。
 * 这个插件把每条启用的规则转成一个原生精确闹钟：到点后系统会拉起
 * {@link PolarisTriggerAlarmReceiver}，由它直接发一条占位通知，再广播事件让 JS 侧跑真正的生成逻辑。
 */
@CapacitorPlugin(name = "PolarisTriggerAlarm")
public class PolarisTriggerAlarmPlugin extends Plugin {

    private static final String ACTION_TRIGGER_FIRED = "com.alyssa.polaris.action.POLARIS_TRIGGER_FIRED";
    private static final String EXTRA_RULE_ID = "ruleId";
    private static final String EXTRA_TITLE = "title";
    private static final String EXTRA_BODY = "body";
    private static final String EXTRA_SCHEDULED_FOR = "scheduledFor";
    private static final String PREFS_NAME = "polaris-trigger-alarms";
    private static final String PREFS_KEY_REQUEST_CODES = "scheduled_request_codes";

    private BroadcastReceiver firedReceiver;

    @Override
    public void load() {
        super.load();
        // 动态注册接收器：闹钟到点时，PolarisTriggerAlarmReceiver 会发一个应用内广播，
        // 这里把它转成 Capacitor 事件通知给前端，让 useChatTriggerRuntime 立即扫描到期规则。
        firedReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (intent == null || !ACTION_TRIGGER_FIRED.equals(intent.getAction())) return;
                String ruleId = intent.getStringExtra(EXTRA_RULE_ID);
                long scheduledFor = intent.getLongExtra(EXTRA_SCHEDULED_FOR, 0L);
                JSObject event = new JSObject();
                event.put("ruleId", ruleId == null ? "" : ruleId);
                event.put("scheduledFor", scheduledFor);
                notifyListeners("triggerFired", event, true);
            }
        };
        IntentFilter filter = new IntentFilter(ACTION_TRIGGER_FIRED);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            getContext().registerReceiver(firedReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            getContext().registerReceiver(firedReceiver, filter);
        }
    }

    @Override
    protected void handleOnDestroy() {
        if (firedReceiver != null) {
            try {
                getContext().unregisterReceiver(firedReceiver);
            } catch (IllegalArgumentException ignored) {
                // 已经注销过。
            }
            firedReceiver = null;
        }
        super.handleOnDestroy();
    }

    /**
     * 全量同步待触发的规则闹钟。会先清掉本插件排过的旧闹钟，再按传入列表重建。
     * 入参 notifications 每一项包含 id / title / body / ruleId / scheduledFor。
     */
    @PluginMethod
    public void sync(PluginCall call) {
        try {
            JSArray notifications = call.getArray("notifications", new JSArray());
            List<PolarisTriggerAlarmNotification> entries = parseNotifications(notifications);

            AlarmManager alarmManager = (AlarmManager) getContext().getSystemService(Context.ALARM_SERVICE);
            if (alarmManager == null) {
                call.reject("系统闹钟服务不可用。");
                return;
            }

            // 先取消所有本插件此前排定的闹钟，避免重复触发，也覆盖被删除/禁用的规则。
            cancelAllAlarms(alarmManager);

            long now = System.currentTimeMillis();
            boolean exactAlarmGranted = canScheduleExactAlarms();
            Set<String> scheduledCodes = new HashSet<>();
            for (PolarisTriggerAlarmNotification entry : entries) {
                if (entry.scheduledFor <= now) {
                    continue;
                }
                scheduleAlarm(alarmManager, entry, exactAlarmGranted);
                scheduledCodes.add(Integer.toString((int) (entry.id & 0x7fffffff)));
            }
            persistScheduledCodes(scheduledCodes);

            JSObject result = new JSObject();
            result.put("exactAlarm", exactAlarmGranted ? "granted" : "denied");
            call.resolve(result);
        } catch (Exception error) {
            call.reject("同步主动消息闹钟失败。", error);
        }
    }

    @PluginMethod
    public void checkExactAlarmSetting(PluginCall call) {
        JSObject result = new JSObject();
        result.put("exactAlarm", canScheduleExactAlarms() ? "granted" : "denied");
        call.resolve(result);
    }

    @PluginMethod
    public void openExactAlarmSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            JSObject result = new JSObject();
            result.put("exactAlarm", "granted");
            call.resolve(result);
            return;
        }
        try {
            Intent intent = new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM);
            intent.setData(android.net.Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
        } catch (Exception ignored) {
            // 部分厂商 ROM 没有标准的精确闹钟设置页，退回应用详情页。
            try {
                Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                intent.setData(android.net.Uri.parse("package:" + getContext().getPackageName()));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
            } catch (Exception ignoredAgain) {
                // 尽力而为，打不开就不跳。
            }
        }
        JSObject result = new JSObject();
        result.put("exactAlarm", canScheduleExactAlarms() ? "granted" : "denied");
        call.resolve(result);
    }

    private List<PolarisTriggerAlarmNotification> parseNotifications(JSArray notifications) {
        List<PolarisTriggerAlarmNotification> entries = new ArrayList<>();
        for (int index = 0; index < notifications.length(); index += 1) {
            Object raw = notifications.opt(index);
            if (!(raw instanceof org.json.JSONObject)) continue;
            JSObject item;
            try {
                item = JSObject.fromJSONObject((org.json.JSONObject) raw);
            } catch (org.json.JSONException ex) {
                continue;
            }
            String ruleId = item.getString("ruleId");
            String title = item.getString("title");
            String body = item.getString("body");
            long id = item.optLong("id", 0L);
            long scheduledFor = item.optLong("scheduledFor", 0L);
            if (ruleId == null || ruleId.isEmpty() || scheduledFor <= 0) continue;
            entries.add(new PolarisTriggerAlarmNotification(
                id,
                ruleId,
                title == null ? "Polaris" : title,
                body == null ? "" : body,
                scheduledFor
            ));
        }
        return entries;
    }

    private void scheduleAlarm(
        AlarmManager alarmManager,
        PolarisTriggerAlarmNotification entry,
        boolean exactAlarmGranted
    ) {
        Intent intent = new Intent(getContext(), PolarisTriggerAlarmReceiver.class);
        intent.setAction(ACTION_TRIGGER_FIRED);
        intent.putExtra(EXTRA_RULE_ID, entry.ruleId);
        intent.putExtra(EXTRA_TITLE, entry.title);
        intent.putExtra(EXTRA_BODY, entry.body);
        intent.putExtra(EXTRA_SCHEDULED_FOR, entry.scheduledFor);

        PendingIntent pendingIntent = PendingIntent.getBroadcast(
            getContext(),
            (int) (entry.id & 0x7fffffff),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            // 锁屏 / Doze 状态下也要尽量按时唤醒；精确闹钟未授权时退回非精确版本。
            if (exactAlarmGranted) {
                alarmManager.setExactAndAllowWhileIdle(
                    AlarmManager.RTC_WAKEUP,
                    entry.scheduledFor,
                    pendingIntent
                );
            } else {
                alarmManager.setAndAllowWhileIdle(
                    AlarmManager.RTC_WAKEUP,
                    entry.scheduledFor,
                    pendingIntent
                );
            }
        } else {
            alarmManager.setExact(AlarmManager.RTC_WAKEUP, entry.scheduledFor, pendingIntent);
        }
    }

    private void cancelAllAlarms(AlarmManager alarmManager) {
        Set<String> previousCodes = readScheduledCodes();
        for (String codeText : previousCodes) {
            try {
                int requestCode = Integer.parseInt(codeText);
                Intent intent = new Intent(getContext(), PolarisTriggerAlarmReceiver.class);
                intent.setAction(ACTION_TRIGGER_FIRED);
                PendingIntent pendingIntent = PendingIntent.getBroadcast(
                    getContext(),
                    requestCode,
                    intent,
                    PendingIntent.FLAG_NO_CREATE | PendingIntent.FLAG_IMMUTABLE
                );
                if (pendingIntent != null) {
                    alarmManager.cancel(pendingIntent);
                    pendingIntent.cancel();
                }
            } catch (NumberFormatException ignored) {
                // 损坏的记录直接跳过。
            }
        }
    }

    private Set<String> readScheduledCodes() {
        SharedPreferences prefs = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        return prefs.getStringSet(PREFS_KEY_REQUEST_CODES, new HashSet<>());
    }

    private void persistScheduledCodes(Set<String> codes) {
        SharedPreferences prefs = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().putStringSet(PREFS_KEY_REQUEST_CODES, codes).apply();
    }

    private boolean canScheduleExactAlarms() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            return true;
        }
        AlarmManager alarmManager = (AlarmManager) getContext().getSystemService(Context.ALARM_SERVICE);
        return alarmManager != null && alarmManager.canScheduleExactAlarms();
    }

    private static final class PolarisTriggerAlarmNotification {
        final long id;
        final String ruleId;
        final String title;
        final String body;
        final long scheduledFor;

        PolarisTriggerAlarmNotification(long id, String ruleId, String title, String body, long scheduledFor) {
            this.id = id;
            this.ruleId = ruleId;
            this.title = title;
            this.body = body;
            this.scheduledFor = scheduledFor;
        }
    }
}
