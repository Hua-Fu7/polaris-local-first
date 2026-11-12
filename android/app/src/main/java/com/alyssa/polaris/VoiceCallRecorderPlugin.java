package com.alyssa.polaris;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioDeviceInfo;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioRecord;
import android.media.MediaPlayer;
import android.media.MediaRecorder;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;

/**
 * 语音通话的原生音频：录一轮说话（静音自动停）、播出回复、以及通话的音频路由开关。
 *
 * 为什么录音不用 WebView 的 getUserMedia：在部分国产 ROM 上这套会直接把 App 打崩。
 * 实测 vivo / Android 15 / WebView 126：Android 音频策略把输入源强制映射成
 * VOICE_COMMUNICATION（WebRTC 的 AEC 要求 VOIP 源），喂给 Chromium 的 float PCM
 * 回调返回 -1（EVENT_MORE_DATA requested 3840 bytes but callback returned -1 bytes），
 * 紧接着 WebView 渲染进程 SIGSEGV，crashpad 判定「render crash 未被处理」后
 * 整个应用被系统杀掉——现象就是「一点麦克风就闪退」。
 *
 * 播放也不用 WebView 的 <audio>：网页层播出来的是**媒体流**，实测 dumpsys
 * media.audio_flinger 里它始终挂在 AUDIO_DEVICE_OUT_BLUETOOTH_A2DP 那条媒体通路上，
 * 而免提切的是通话通路，两者互不影响——扬声器与听筒的选择对网页播放完全无效。
 * 用 USAGE_VOICE_COMMUNICATION 播，才会跟着 setCommunicationDevice 走。
 *
 * 但「跟着通话设备走」也有反面：戴着耳机时，通话通路里往往没有它的位置（蓝牙音乐耳机
 * 只挂在 A2DP 上），硬指定听筒就等于把声音留在手机上——用户戴着耳机什么都听不到。
 * 所以播放通路按当下插着什么来挑（见 resolvePlaybackPlan）：免提走通话通路的扬声器，
 * 有耳机就走媒体通路（mode 也要退回 NORMAL，通话模式会把播放整体约束到通话通路上），
 * 什么都没有才用通话通路的听筒。
 *
 * 录音挪到原生侧后完全不经过 WebView 的音频栈，同时也顺手拿到几个好处：
 * 采样率和格式可控（16kHz 单声道 PCM16 是语音识别的最佳输入，比录音笔式的
 * 48kHz float 小一个数量级），静音判断不受渲染进程卡顿影响。
 *
 * 输出 WAV：44 字节头是纯 Java 就能拼的，且所有语音识别接口都认这个格式。
 */
@CapacitorPlugin(
    name = "VoiceCallRecorder",
    permissions = @Permission(
        alias = "microphone",
        strings = { Manifest.permission.RECORD_AUDIO }
    )
)
public class VoiceCallRecorderPlugin extends Plugin {

    /** 语音识别只关心 8k 带宽，16k 足够，且体积最小。 */
    private static final int[] SAMPLE_RATE_CANDIDATES = { 16000, 44100, 48000 };
    private static final int CHANNEL_MASK = AudioFormat.CHANNEL_IN_MONO;
    private static final int ENCODING = AudioFormat.ENCODING_PCM_16BIT;

    private static final int DEFAULT_SILENCE_MS = 1100;
    private static final int DEFAULT_MIN_SPEECH_MS = 250;
    private static final int DEFAULT_MAX_TURN_MS = 30000;
    private static final int DEFAULT_NO_SPEECH_MS = 8000;

    /** 帧长 20ms：够平滑地驱动 UI 音量条，又不会把通知刷爆。 */
    private static final int FRAME_DURATION_DIVISOR = 50;
    private static final int LEVEL_NOTIFY_INTERVAL_MS = 50;

    private static final double SPEECH_RMS_MULTIPLIER = 2.4;
    private static final double SPEECH_RMS_FLOOR = 0.012;
    /** 先用若干帧学一下房间的本底噪声，再开始判断有没有人说话。 */
    private static final int CALIBRATION_FRAMES = 14;

    private AudioRecord capture;
    private int sampleRate;
    private volatile Turn activeTurn;
    private MediaPlayer speechPlayer;
    /** The playSpeech call still waiting for its turn to finish. */
    private PluginCall speechCall;
    /**
     * 免提开关的当前值。不用 AudioManager.isSpeakerphoneOn() 回读：走媒体通路时
     * 我们根本不碰那个开关，读回来会是上一次通话留下的旧值。
     */
    private volatile boolean speakerphoneRoute = false;

    @PluginMethod
    public void startTurn(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            requestPermissionForAlias("microphone", call, "microphonePermissionCallback");
            return;
        }
        beginTurn(call);
    }

    @PermissionCallback
    private void microphonePermissionCallback(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            call.reject("麦克风权限被拒绝了。", "permission-denied");
            return;
        }
        beginTurn(call);
    }

    /**
     * 让正在录的这一轮立刻收尾。默认保留已经说出的话（打断 AI 时用），
     * 传 discard=true 则整轮丢掉（用户按下静音时用，静音前那半句不该发出去）。
     */
    @PluginMethod
    public void cancelTurn(PluginCall call) {
        Boolean discard = call.getBoolean("discard", Boolean.FALSE);
        Turn turn = activeTurn;
        if (turn != null) {
            turn.discard = discard != null && discard;
            turn.interrupted = true;
        }
        call.resolve();
    }

    /**
     * 免提开关：扬声器（true）与听筒（false）。
     *
     * 只说「用哪条路」不够，还得把系统切进通话模式——听筒只有在
     * MODE_IN_COMMUNICATION 下才是可选设备。Android 12 起用
     * setCommunicationDevice 指定设备，同时仍然调用 setSpeakerphoneOn，
     * 因为部分 ROM 只认后者。
     */
    @PluginMethod
    public void setSpeakerphone(PluginCall call) {
        Boolean requested = call.getBoolean("speakerphone", Boolean.TRUE);
        boolean speakerphone = requested == null || requested;
        AudioManager manager = audioManager();
        if (manager == null) {
            call.reject("没有找到音频服务。", "no-audio-service");
            return;
        }
        this.speakerphoneRoute = speakerphone;
        try {
            applyRoute(manager, speakerphone);
        } catch (Exception error) {
            String message = error.getMessage();
            call.reject(message == null ? "切换音频路由失败。" : message, "route-failed");
            return;
        }
        JSObject result = new JSObject();
        result.put("speakerphone", speakerphone);
        call.resolve(result);
    }

    /**
     * 播一轮回复。resolve 发生在播完（completed=true）或被 stopSpeech 打断
     * （completed=false）时，JS 侧就靠这个 promise 知道「AI 说完了」。
     */
    @PluginMethod
    public void playSpeech(PluginCall call) {
        String base64 = call.getString("base64");
        if (base64 == null || base64.isEmpty()) {
            call.reject("没有音频数据。", "empty-audio");
            return;
        }
        String mimeType = call.getString("mimeType", "audio/mpeg");
        byte[] bytes;
        try {
            bytes = Base64.decode(base64, Base64.DEFAULT);
        } catch (Exception error) {
            call.reject("音频数据解不开。", "bad-audio");
            return;
        }
        // MediaPlayer 的回调要求创建线程有 Looper，而插件方法不在主线程上。
        new Handler(Looper.getMainLooper()).post(() -> startSpeech(call, bytes, mimeType));
    }

    /** 打断正在播的回复。没有在播时是空操作。 */
    @PluginMethod
    public void stopSpeech(PluginCall call) {
        new Handler(Looper.getMainLooper()).post(() -> {
            stopSpeechPlayback();
            settleSpeech(false);
        });
        call.resolve();
    }

    private void startSpeech(PluginCall call, byte[] bytes, String mimeType) {
        stopSpeechPlayback();
        settleSpeech(false);

        File file = new File(getContext().getCacheDir(), "voice-call-reply" + extensionFor(mimeType));
        try {
            FileOutputStream out = new FileOutputStream(file);
            out.write(bytes);
            out.flush();
            out.close();
        } catch (Exception error) {
            call.reject("写临时音频文件失败。", "playback-failed");
            return;
        }

        MediaPlayer player = new MediaPlayer();
        /*
         * 通路按「现在插着什么」现算，而不是沿用通话开始时的决定：耳机是中途插拔的，
         * 而且这样免提按钮的意图也能压过耳机（戴着耳机点免提 → 声音回扬声器）。
         */
        AudioManager manager = audioManager();
        PlaybackPlan plan = resolvePlaybackPlan(manager, speakerphoneRoute);
        player.setAudioAttributes(
            new AudioAttributes.Builder()
                .setUsage(plan.usage)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build()
        );
        try {
            player.setDataSource(file.getAbsolutePath());
            player.prepare();
        } catch (Exception error) {
            player.release();
            call.reject("这个音频格式播不了。", "playback-failed");
            return;
        }

        speechPlayer = player;
        speechCall = call;
        player.setOnCompletionListener(mediaPlayer -> {
            stopSpeechPlayback();
            settleSpeech(true);
        });
        player.setOnErrorListener((mediaPlayer, what, extra) -> {
            stopSpeechPlayback();
            settleSpeech(false);
            return true;
        });
        try {
            player.start();
        } catch (Exception error) {
            stopSpeechPlayback();
            speechCall = call;
            settleSpeech(false);
        }
    }

    /** 停掉播放器并断开回调，避免收尾时再触发一次 onCompletion。 */
    private void stopSpeechPlayback() {
        MediaPlayer player = speechPlayer;
        speechPlayer = null;
        if (player == null) return;
        player.setOnCompletionListener(null);
        player.setOnErrorListener(null);
        try {
            player.stop();
        } catch (Exception ignored) {
            // 已经停了。
        }
        try {
            player.release();
        } catch (Exception ignored) {
            // 已经释放了。
        }
    }

    /** 回执挂起的 playSpeech。JS 侧在等这个 promise，漏掉就会卡住整通电话。 */
    private void settleSpeech(boolean completed) {
        PluginCall pending = speechCall;
        speechCall = null;
        if (pending == null) return;
        JSObject result = new JSObject();
        result.put("completed", completed);
        try {
            pending.resolve(result);
        } catch (Exception ignored) {
            // 页面已经销毁时 bridge 会拒绝回执。
        }
    }

    private static String extensionFor(String mimeType) {
        String base = mimeType == null ? "" : mimeType.split(";")[0].trim().toLowerCase();
        if (base.equals("audio/wav") || base.equals("audio/x-wav")) return ".wav";
        if (base.equals("audio/mp4") || base.equals("audio/m4a") || base.equals("audio/aac")) return ".m4a";
        if (base.equals("audio/ogg")) return ".ogg";
        if (base.equals("audio/webm")) return ".webm";
        return ".mp3";
    }

    /** 通话结束：停掉麦克风和播放，把音频模式还给系统。 */
    @PluginMethod
    public void release(PluginCall call) {
        Turn turn = activeTurn;
        activeTurn = null;
        if (turn != null) turn.interrupted = true;
        shutdownCapture();
        new Handler(Looper.getMainLooper()).post(() -> {
            stopSpeechPlayback();
            settleSpeech(false);
        });
        restoreAudioMode();
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        Turn turn = activeTurn;
        activeTurn = null;
        if (turn != null) turn.interrupted = true;
        shutdownCapture();
        stopSpeechPlayback();
        settleSpeech(false);
        restoreAudioMode();
    }

    private AudioManager audioManager() {
        Object service = getContext().getSystemService(Context.AUDIO_SERVICE);
        return service instanceof AudioManager ? (AudioManager) service : null;
    }

    /**
     * 一次播放该走哪条路。
     *
     * `mode` 必须和 `usage` 配套：实测（vivo / Android 15）通话模式会把播放整体约束到
     * 通话通路上，即便 usage 是 USAGE_MEDIA 也照样落在听筒上（flinger 里那条线程带着
     * AUDIO_OUTPUT_FLAG_INCALL_MUSIC）。所以走媒体通路时要把 mode 放回 NORMAL。
     *
     * `communicationDevice` 为 null 表示这次不需要指定通信设备。
     */
    private static final class PlaybackPlan {
        final int mode;
        final int usage;
        final AudioDeviceInfo communicationDevice;

        PlaybackPlan(int mode, int usage, AudioDeviceInfo communicationDevice) {
            this.mode = mode;
            this.usage = usage;
            this.communicationDevice = communicationDevice;
        }

        boolean usesCallRoute() {
            return usage == AudioAttributes.USAGE_VOICE_COMMUNICATION;
        }
    }

    /**
     * 能出声到「只有用户听得到」的设备：有线、USB、蓝牙 A2DP、蓝牙 SCO、BLE、助听器。
     *
     * 注意**不能**拿 BLUETOOTH_SCO 当「真有耳机」的证据：部分 ROM（实测 vivo）在没连
     * 耳机时也会挂一个虚拟 SCO 设备，把它当成通信设备选下去，系统会真的去建 SCO，
     * 声音反而落进一条没人听的链路。所以这里的判据只用来决定「走媒体通路还是听筒」，
     * 不再用它去指定通信设备。
     */
    private static boolean isPersonalOutput(int type) {
        if (type == AudioDeviceInfo.TYPE_WIRED_HEADSET
            || type == AudioDeviceInfo.TYPE_USB_HEADSET
            || type == AudioDeviceInfo.TYPE_USB_DEVICE
            || type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP
            || type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO) {
            return true;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && type == AudioDeviceInfo.TYPE_BLE_HEADSET) {
            return true;
        }
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && type == AudioDeviceInfo.TYPE_HEARING_AID;
    }

    /**
     * 挑这次的播放通路。
     *
     * 关键的一条：**耳机连着的时候不能把声音留在通话通路上**。蓝牙音乐耳机只挂在
     * A2DP（媒体通路），通话通路里没有它的位置；把通信设备设成听筒的后果就是声音
     * 落在手机上，用户戴着耳机什么都听不到（实测 vivo：scoManagedByAudio=false，
     * 系统不会替应用代转）。
     *
     * 所以规则只有三条，都是「用户现在能听到什么，声音就去哪里」：
     *   - 免提 → 扬声器，走通话通路；
     *   - 有耳机（有线 / USB / A2DP / BLE / SCO）→ 回普通模式走媒体通路，让耳机按
     *     听音乐那条路接住它，同时不指定通信设备——指定了反而会把 SCO 拽起来；
     *   - 没有耳机 → 听筒，走通话通路，像真电话一样小声。
     */
    private PlaybackPlan resolvePlaybackPlan(AudioManager manager, boolean speakerphone) {
        if (manager == null) {
            return new PlaybackPlan(AudioManager.MODE_IN_COMMUNICATION, AudioAttributes.USAGE_VOICE_COMMUNICATION, null);
        }
        if (speakerphone) {
            return new PlaybackPlan(
                AudioManager.MODE_IN_COMMUNICATION,
                AudioAttributes.USAGE_VOICE_COMMUNICATION,
                findOutput(manager, AudioDeviceInfo.TYPE_BUILTIN_SPEAKER)
            );
        }
        boolean hasPersonalOutput = false;
        for (AudioDeviceInfo device : manager.getDevices(AudioManager.GET_DEVICES_OUTPUTS)) {
            if (isPersonalOutput(device.getType())) {
                hasPersonalOutput = true;
                break;
            }
        }
        if (hasPersonalOutput) {
            return new PlaybackPlan(AudioManager.MODE_NORMAL, AudioAttributes.USAGE_MEDIA, null);
        }
        return new PlaybackPlan(
            AudioManager.MODE_IN_COMMUNICATION,
            AudioAttributes.USAGE_VOICE_COMMUNICATION,
            findOutput(manager, AudioDeviceInfo.TYPE_BUILTIN_EARPIECE)
        );
    }

    @SuppressWarnings("deprecation")
    private void applyRoute(AudioManager manager, boolean speakerphone) {
        PlaybackPlan plan = resolvePlaybackPlan(manager, speakerphone);
        /*
         * 通话模式只对通话通路有意义：USAGE_VOICE_COMMUNICATION 的播放只有在
         * MODE_IN_COMMUNICATION 下才跟着通信设备走，回到 MODE_NORMAL 它就退化成普通
         * 媒体输出、免提开关也就没意义了。反过来，走媒体通路（耳机）时必须退出通话
         * 模式，否则系统会把播放也按通话通路发出去。
         */
        manager.setMode(plan.mode);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (plan.communicationDevice != null) {
                manager.setCommunicationDevice(plan.communicationDevice);
            } else {
                // 走媒体通路时不能留下一个听筒设备，否则系统会顺着它去建 SCO，
                // 耳机反而被拽进通话状态、音乐通路哑掉。
                manager.clearCommunicationDevice();
            }
        }
        // 老接口在部分 ROM 上才是实际生效的那个，两个都写。但只在真的要用通话
        // 通路时才拨：走媒体通路时 setSpeakerphoneOn(false) 有把 SCO 拉起来的
        // 副作用，那正好是我们要避开的那件事。
        if (plan.usesCallRoute()) {
            manager.setSpeakerphoneOn(speakerphone);
        }
    }

    private AudioDeviceInfo findOutput(AudioManager manager, int type) {
        for (AudioDeviceInfo device : manager.getDevices(AudioManager.GET_DEVICES_OUTPUTS)) {
            if (device.getType() == type) return device;
        }
        return null;
    }

    /** 通话结束后必须还原，否则整个 App 的媒体声音都会走通话链路。 */
    @SuppressWarnings("deprecation")
    private void restoreAudioMode() {
        AudioManager manager = audioManager();
        if (manager == null) return;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) manager.clearCommunicationDevice();
            manager.setSpeakerphoneOn(true);
            manager.setMode(AudioManager.MODE_NORMAL);
        } catch (Exception ignored) {
            // 还原失败不该影响通话收尾。
        }
    }

    private void beginTurn(PluginCall call) {
        if (activeTurn != null) {
            call.reject("上一轮还在录音。", "busy");
            return;
        }
        if (!ensureCapture()) {
            call.reject("没有找到可用的麦克风。", "no-microphone");
            return;
        }

        Turn turn = new Turn(
            call,
            capture,
            sampleRate,
            readIntOption(call, "silenceMs", DEFAULT_SILENCE_MS),
            readIntOption(call, "minSpeechMs", DEFAULT_MIN_SPEECH_MS),
            readIntOption(call, "maxTurnMs", DEFAULT_MAX_TURN_MS),
            readIntOption(call, "noSpeechMs", DEFAULT_NO_SPEECH_MS)
        );
        activeTurn = turn;
        Thread thread = new Thread(turn, "polaris-voice-call");
        thread.setDaemon(true);
        thread.start();
    }

    private int readIntOption(PluginCall call, String key, int fallback) {
        Integer value = call.getInt(key);
        if (value == null || value <= 0) return fallback;
        return value;
    }

    @SuppressLint("MissingPermission")
    private boolean ensureCapture() {
        AudioRecord current = capture;
        if (current != null && current.getState() == AudioRecord.STATE_INITIALIZED) return true;
        shutdownCapture();

        for (int candidate : SAMPLE_RATE_CANDIDATES) {
            int minBufferBytes = AudioRecord.getMinBufferSize(candidate, CHANNEL_MASK, ENCODING);
            if (minBufferBytes <= 0) continue;
            int bufferBytes = Math.max(minBufferBytes, candidate / 5 * 2);
            AudioRecord record;
            try {
                record = new AudioRecord(
                    MediaRecorder.AudioSource.MIC,
                    candidate,
                    CHANNEL_MASK,
                    ENCODING,
                    bufferBytes
                );
            } catch (Exception error) {
                continue;
            }
            if (record.getState() != AudioRecord.STATE_INITIALIZED) {
                try {
                    record.release();
                } catch (Exception ignored) {
                    // 初始化失败时 release 也可能抛，忽略即可。
                }
                continue;
            }
            capture = record;
            sampleRate = candidate;
            return true;
        }
        return false;
    }

    private void shutdownCapture() {
        AudioRecord current = capture;
        capture = null;
        if (current == null) return;
        try {
            if (current.getRecordingState() == AudioRecord.RECORDSTATE_RECORDING) {
                // stop() 会把阻塞中的 read() 唤醒，所以要先停再释放。
                current.stop();
            }
        } catch (Exception ignored) {
            // 已经停了。
        }
        try {
            current.release();
        } catch (Exception ignored) {
            // 已经释放了。
        }
    }

    private static byte[] pcmToWav(byte[] pcm, int sampleRate, int channels, int bitsPerSample) {
        int blockAlign = channels * bitsPerSample / 8;
        int byteRate = sampleRate * blockAlign;
        int dataSize = pcm.length;
        byte[] header = new byte[44];
        writeAscii(header, 0, "RIFF");
        writeIntLe(header, 4, 36 + dataSize);
        writeAscii(header, 8, "WAVE");
        writeAscii(header, 12, "fmt ");
        writeIntLe(header, 16, 16);
        writeShortLe(header, 20, 1);
        writeShortLe(header, 22, channels);
        writeIntLe(header, 24, sampleRate);
        writeIntLe(header, 28, byteRate);
        writeShortLe(header, 32, blockAlign);
        writeShortLe(header, 34, bitsPerSample);
        writeAscii(header, 36, "data");
        writeIntLe(header, 40, dataSize);

        byte[] wav = new byte[44 + dataSize];
        System.arraycopy(header, 0, wav, 0, 44);
        System.arraycopy(pcm, 0, wav, 44, dataSize);
        return wav;
    }

    private static void writeAscii(byte[] target, int offset, String value) {
        for (int index = 0; index < value.length(); index += 1) {
            target[offset + index] = (byte) value.charAt(index);
        }
    }

    private static void writeIntLe(byte[] target, int offset, int value) {
        target[offset] = (byte) (value & 0xFF);
        target[offset + 1] = (byte) ((value >> 8) & 0xFF);
        target[offset + 2] = (byte) ((value >> 16) & 0xFF);
        target[offset + 3] = (byte) ((value >> 24) & 0xFF);
    }

    private static void writeShortLe(byte[] target, int offset, int value) {
        target[offset] = (byte) (value & 0xFF);
        target[offset + 1] = (byte) ((value >> 8) & 0xFF);
    }

    /** 一轮录音：读 PCM、算音量、静音自动收尾，最后把 WAV 交回 JS。 */
    private final class Turn implements Runnable {
        private final PluginCall call;
        private final AudioRecord capture;
        private final int sampleRate;
        private final int silenceMs;
        private final int minSpeechMs;
        private final int maxTurnMs;
        private final int noSpeechMs;
        private volatile boolean interrupted = false;
        /** 被取消时是否连已经录到的内容一起丢掉。 */
        private volatile boolean discard = false;
        private boolean settled = false;

        Turn(
            PluginCall call,
            AudioRecord capture,
            int sampleRate,
            int silenceMs,
            int minSpeechMs,
            int maxTurnMs,
            int noSpeechMs
        ) {
            this.call = call;
            this.capture = capture;
            this.sampleRate = sampleRate;
            this.silenceMs = silenceMs;
            this.minSpeechMs = minSpeechMs;
            this.maxTurnMs = maxTurnMs;
            this.noSpeechMs = noSpeechMs;
        }

        @Override
        public void run() {
            final int frameSamples = Math.max(sampleRate / FRAME_DURATION_DIVISOR, 160);
            final short[] frame = new short[frameSamples];
            final byte[] scratch = new byte[frameSamples * 2];
            final ByteArrayOutputStream pcm = new ByteArrayOutputStream(sampleRate * 2 * 4);

            try {
                capture.startRecording();
            } catch (Exception error) {
                settleFailure("capture-failed", "麦克风启动失败。");
                return;
            }

            final long startedAt = SystemClock.elapsedRealtime();
            long lastVoiceAt = startedAt;
            long lastLevelAt = 0;
            int calibrationFrames = 0;
            double noiseFloor = 0;
            double speechMs = 0;
            boolean sawSpeech = false;
            String outcome = null;

            while (!interrupted) {
                int read = capture.read(frame, 0, frameSamples);
                if (read < 0) {
                    outcome = "capture-failed";
                    break;
                }
                if (read == 0) continue;

                for (int index = 0; index < read; index += 1) {
                    short sample = frame[index];
                    scratch[index * 2] = (byte) (sample & 0xFF);
                    scratch[index * 2 + 1] = (byte) ((sample >> 8) & 0xFF);
                }
                pcm.write(scratch, 0, read * 2);

                double sum = 0;
                for (int index = 0; index < read; index += 1) {
                    double normalized = frame[index] / 32768.0;
                    sum += normalized * normalized;
                }
                double rms = Math.sqrt(sum / read);

                long now = SystemClock.elapsedRealtime();
                long elapsed = now - startedAt;
                double deltaMs = read * 1000.0 / sampleRate;

                if (calibrationFrames < CALIBRATION_FRAMES) {
                    calibrationFrames += 1;
                    noiseFloor = Math.max(noiseFloor, rms);
                } else {
                    double threshold = Math.max(noiseFloor * SPEECH_RMS_MULTIPLIER, SPEECH_RMS_FLOOR);
                    if (rms > threshold) {
                        sawSpeech = true;
                        speechMs += deltaMs;
                        lastVoiceAt = now;
                    }
                }

                if (now - lastLevelAt >= LEVEL_NOTIFY_INTERVAL_MS) {
                    lastLevelAt = now;
                    JSObject event = new JSObject();
                    // 原始 RMS，缩放交给前端，和 WebView 版录音保持同一套语义。
                    event.put("level", rms);
                    event.put("speaking", sawSpeech);
                    notifyListeners("level", event);
                }

                if (sawSpeech && speechMs >= minSpeechMs && now - lastVoiceAt >= silenceMs) {
                    outcome = "ok";
                    break;
                }
                if (!sawSpeech && elapsed >= noSpeechMs) {
                    outcome = "no-speech";
                    break;
                }
                if (elapsed >= maxTurnMs) {
                    outcome = sawSpeech ? "ok" : "no-speech";
                    break;
                }
            }

            try {
                if (capture.getRecordingState() == AudioRecord.RECORDSTATE_RECORDING) {
                    capture.stop();
                }
            } catch (Exception ignored) {
                // 已经被外部停掉了。
            }

            if (outcome == null) outcome = sawSpeech ? "ok" : "no-speech";
            // 静音丢掉整轮：半句话不该被转写，更不该发到对话框里。
            if (discard) {
                settleFailure("muted", "这一轮被丢弃了。");
                return;
            }
            if ("capture-failed".equals(outcome)) {
                settleFailure("capture-failed", "麦克风读取失败。");
                return;
            }
            long durationMs = SystemClock.elapsedRealtime() - startedAt;
            if (!sawSpeech || pcm.size() == 0) {
                settleFailure("no-speech", "没有听到说话。");
                return;
            }

            byte[] wav = pcmToWav(pcm.toByteArray(), sampleRate, 1, 16);
            settleSuccess(wav, durationMs, speechMs);
        }

        private void settleSuccess(byte[] wav, long durationMs, double speechMs) {
            synchronized (this) {
                if (settled) return;
                settled = true;
            }
            clearActiveTurn();
            JSObject result = new JSObject();
            result.put("base64", Base64.encodeToString(wav, Base64.NO_WRAP));
            result.put("mimeType", "audio/wav");
            result.put("sampleRate", sampleRate);
            result.put("durationMs", durationMs);
            result.put("speechMs", (long) speechMs);
            try {
                call.resolve(result);
            } catch (Exception ignored) {
                // 页面已经销毁时 bridge 会拒绝回执，此时没人等结果了。
            }
        }

        private void settleFailure(String code, String message) {
            synchronized (this) {
                if (settled) return;
                settled = true;
            }
            clearActiveTurn();
            try {
                call.reject(message, code);
            } catch (Exception ignored) {
                // 同上：页面已经销毁。
            }
        }

        private void clearActiveTurn() {
            if (activeTurn == this) activeTurn = null;
        }
    }
}
