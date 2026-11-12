import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The adapter is what keeps the call loop platform-agnostic, so these tests pin
 * down which recorder it builds and how native failures reach the loop.
 */

type LevelListener = (event: { level: number; speaking: boolean }) => void;

const bridge = vi.hoisted(() => ({
  canUseNative: true,
  recordTurn: vi.fn(),
  cancelTurn: vi.fn(async () => undefined),
  setSpeakerphone: vi.fn(async (speakerphone: boolean) => ({ speakerphone })),
  release: vi.fn(async () => undefined),
  levelHandleRemove: vi.fn(async () => undefined),
  addLevelListener: vi.fn()
}));

vi.mock('../../native/voiceCallRecorder', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../native/voiceCallRecorder')>();
  return {
    ...actual,
    canUseNativeVoiceCallRecorder: () => bridge.canUseNative,
    recordNativeVoiceCallTurn: bridge.recordTurn,
    cancelNativeVoiceCallTurn: bridge.cancelTurn,
    setNativeVoiceCallSpeakerphone: bridge.setSpeakerphone,
    releaseNativeVoiceCallRecorder: bridge.release,
    addNativeVoiceCallLevelListener: bridge.addLevelListener
  };
});

import { canControlVoiceCallRoute, createVoiceCallRecorder } from './voiceCallRecorderAdapter';
import { VoiceCallRecorderError } from './voiceCallRecorder';

function encodeBase64(bytes: number[]) {
  return btoa(bytes.map((byte) => String.fromCharCode(byte)).join(''));
}

function turnResult() {
  return {
    base64: encodeBase64([82, 73, 70, 70, 0, 0]),
    mimeType: 'audio/wav',
    sampleRate: 16000,
    durationMs: 1500,
    speechMs: 800
  };
}

function nativeRejection(code: string, message: string) {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}

/** Captures the listener the adapter registers so a test can drive the meter. */
function captureLevelListener() {
  let emit: LevelListener | null = null;
  bridge.addLevelListener.mockImplementation(async (listener: LevelListener) => {
    emit = listener;
    return { remove: bridge.levelHandleRemove };
  });
  return (event: { level: number; speaking: boolean }) => emit?.(event);
}

beforeEach(() => {
  bridge.canUseNative = true;
  bridge.recordTurn.mockReset();
  bridge.cancelTurn.mockClear();
  bridge.setSpeakerphone.mockClear();
  bridge.release.mockClear();
  bridge.levelHandleRemove.mockClear();
  bridge.addLevelListener.mockReset();
  bridge.addLevelListener.mockImplementation(async () => ({
    remove: bridge.levelHandleRemove
  }));
});

describe('createVoiceCallRecorder', () => {
  it('wraps the native plugin on Android', async () => {
    bridge.recordTurn.mockResolvedValue(turnResult());
    const recorder = createVoiceCallRecorder();
    await recorder.prime();
    expect(bridge.addLevelListener).toHaveBeenCalledTimes(1);

    const recording = await recorder.recordTurn();
    expect(bridge.recordTurn).toHaveBeenCalledTimes(1);
    expect(recording.mimeType).toBe('audio/wav');
    expect(recording.durationMs).toBe(1500);
    expect(recording.speechMs).toBe(800);
    expect(recording.blob.type).toBe('audio/wav');
    expect(recording.blob.size).toBe(6);
  });

  it('forwards the level meter to the caller callback while a turn runs', async () => {
    const emit = captureLevelListener();
    const levels: number[] = [];
    bridge.recordTurn.mockImplementation(async () => {
      emit({ level: 0.42, speaking: true });
      emit({ level: 0.1, speaking: true });
      return turnResult();
    });

    const recorder = createVoiceCallRecorder();
    await recorder.prime();
    await recorder.recordTurn({ onLevel: (level) => levels.push(level) });

    expect(levels).toEqual([0.42, 0.1]);
  });

  it('stops pushing levels once the turn has settled', async () => {
    const emit = captureLevelListener();
    const levels: number[] = [];
    bridge.recordTurn.mockImplementation(async () => {
      emit({ level: 0.5, speaking: true });
      return turnResult();
    });

    const recorder = createVoiceCallRecorder();
    await recorder.prime();
    await recorder.recordTurn({ onLevel: (level) => levels.push(level) });
    emit({ level: 0.9, speaking: true });

    expect(levels).toEqual([0.5]);
  });

  it('maps native error codes onto recorder failure kinds', async () => {
    const cases: Array<[string, string]> = [
      ['permission-denied', 'permission-denied'],
      ['no-microphone', 'no-microphone'],
      ['capture-failed', 'no-microphone'],
      ['no-speech', 'no-speech'],
      ['busy', 'busy']
    ];

    for (const [code, kind] of cases) {
      bridge.recordTurn.mockRejectedValueOnce(nativeRejection(code, `failed: ${code}`));
      const recorder = createVoiceCallRecorder();
      await expect(recorder.recordTurn()).rejects.toMatchObject({
        name: 'VoiceCallRecorderError',
        kind
      });
    }
  });

  it('treats an unknown native failure as unsupported', async () => {
    bridge.recordTurn.mockRejectedValueOnce(new Error('boom'));
    const recorder = createVoiceCallRecorder();
    const failure = await recorder.recordTurn().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(VoiceCallRecorderError);
    expect((failure as VoiceCallRecorderError).kind).toBe('unsupported');
  });

  it('releases the native microphone and detaches the level listener', async () => {
    bridge.recordTurn.mockResolvedValue(turnResult());
    const recorder = createVoiceCallRecorder();
    await recorder.prime();
    recorder.cancel();
    recorder.release();

    expect(bridge.cancelTurn).toHaveBeenCalledTimes(1);
    expect(bridge.release).toHaveBeenCalledTimes(1);
    expect(bridge.levelHandleRemove).toHaveBeenCalledTimes(1);
  });

  it('tells the native side whether a cancelled turn should be discarded', async () => {
    const recorder = createVoiceCallRecorder();
    await recorder.prime();

    // Interrupting the assistant keeps the turn; muting throws it away.
    recorder.cancel();
    expect(bridge.cancelTurn).toHaveBeenLastCalledWith(false);
    recorder.cancel({ discard: true });
    expect(bridge.cancelTurn).toHaveBeenLastCalledWith(true);
  });

  it('routes the call output through the native audio manager', async () => {
    const recorder = createVoiceCallRecorder();
    await recorder.setSpeakerphone(true);
    expect(bridge.setSpeakerphone).toHaveBeenCalledWith(true);
    await recorder.setSpeakerphone(false);
    expect(bridge.setSpeakerphone).toHaveBeenLastCalledWith(false);
  });

  it('offers the earpiece/speaker switch only where the platform can route it', async () => {
    expect(canControlVoiceCallRoute()).toBe(true);

    bridge.canUseNative = false;
    expect(canControlVoiceCallRoute()).toBe(false);
    // The browser picks its own output device, so switching is a silent no-op.
    const recorder = createVoiceCallRecorder();
    await expect(recorder.setSpeakerphone(true)).resolves.toBeUndefined();
    expect(bridge.setSpeakerphone).not.toHaveBeenCalled();
  });

  it('keeps the WebView recorder when the native plugin is unavailable', async () => {
    bridge.canUseNative = false;
    const recorder = createVoiceCallRecorder();
    // The test environment has no getUserMedia, so warming the WebView recorder
    // is expected to report itself unsupported.
    await recorder.prime().catch(() => undefined);
    expect(bridge.addLevelListener).not.toHaveBeenCalled();

    const failure = await recorder.recordTurn().catch((error: unknown) => error);
    expect(bridge.recordTurn).not.toHaveBeenCalled();
    expect(failure).toBeInstanceOf(VoiceCallRecorderError);
    expect((failure as VoiceCallRecorderError).kind).toBe('unsupported');
  });
});
