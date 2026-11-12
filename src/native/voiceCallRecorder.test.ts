import { afterEach, describe, expect, it, vi } from 'vitest';

const nativePlugin = vi.hoisted(() => ({
  startTurn: vi.fn(),
  cancelTurn: vi.fn(async () => undefined),
  setSpeakerphone: vi.fn(async (options: { speakerphone: boolean }) => ({ speakerphone: options.speakerphone })),
  playSpeech: vi.fn(async () => ({ completed: true })),
  stopSpeech: vi.fn(async () => undefined),
  release: vi.fn(async () => undefined),
  addListener: vi.fn()
}));

const capacitorState = vi.hoisted(() => ({
  native: true,
  available: true,
  platform: 'android'
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => capacitorState.native,
    isPluginAvailable: () => capacitorState.available,
    getPlatform: () => capacitorState.platform
  },
  registerPlugin: () => nativePlugin
}));

import {
  addNativeVoiceCallLevelListener,
  canPlayNativeVoiceCallSpeech,
  canUseNativeVoiceCallRecorder,
  cancelNativeVoiceCallTurn,
  nativeVoiceCallTurnToBytes,
  playNativeVoiceCallSpeech,
  recordNativeVoiceCallTurn,
  setNativeVoiceCallSpeakerphone,
  stopNativeVoiceCallSpeech
} from './voiceCallRecorder';

function encodeBase64(bytes: number[]) {
  return btoa(bytes.map((byte) => String.fromCharCode(byte)).join(''));
}

afterEach(() => {
  capacitorState.native = true;
  capacitorState.available = true;
  capacitorState.platform = 'android';
  nativePlugin.startTurn.mockReset();
  nativePlugin.cancelTurn.mockClear();
  nativePlugin.setSpeakerphone.mockClear();
  nativePlugin.playSpeech.mockReset();
  nativePlugin.playSpeech.mockImplementation(async () => ({ completed: true }));
  nativePlugin.stopSpeech.mockClear();
  nativePlugin.release.mockClear();
  nativePlugin.addListener.mockReset();
});
describe('canUseNativeVoiceCallRecorder', () => {
  it('uses the native recorder on Android', () => {
    expect(canUseNativeVoiceCallRecorder()).toBe(true);
  });

  it('falls back to the WebView recorder on other platforms', () => {
    capacitorState.platform = 'ios';
    expect(canUseNativeVoiceCallRecorder()).toBe(false);
  });

  it('falls back when the plugin is not registered', () => {
    capacitorState.available = false;
    expect(canUseNativeVoiceCallRecorder()).toBe(false);
  });
});

describe('recordNativeVoiceCallTurn', () => {
  it('passes the turn timing options through to the plugin', async () => {
    nativePlugin.startTurn.mockResolvedValue({
      base64: encodeBase64([1, 2, 3]),
      mimeType: 'audio/wav',
      sampleRate: 16000,
      durationMs: 1400,
      speechMs: 900
    });

    const result = await recordNativeVoiceCallTurn({
      silenceMs: 1100,
      minSpeechMs: 250,
      maxTurnMs: 30000,
      noSpeechMs: 8000
    });

    expect(nativePlugin.startTurn).toHaveBeenCalledWith({
      silenceMs: 1100,
      minSpeechMs: 250,
      maxTurnMs: 30000,
      noSpeechMs: 8000
    });
    expect(result.mimeType).toBe('audio/wav');
    expect(result.sampleRate).toBe(16000);
    expect(result.speechMs).toBe(900);
  });
});

describe('nativeVoiceCallTurnToBytes', () => {
  it('decodes the base64 payload into the original bytes', () => {
    const bytes = nativeVoiceCallTurnToBytes({
      base64: encodeBase64([82, 73, 70, 70]),
      mimeType: 'audio/wav',
      sampleRate: 16000,
      durationMs: 100,
      speechMs: 100
    });
    expect(Array.from(bytes)).toEqual([82, 73, 70, 70]);
  });

  it('hands back a view that Blob accepts', () => {
    const bytes = nativeVoiceCallTurnToBytes({
      base64: encodeBase64([1, 2, 3, 4]),
      mimeType: 'audio/wav',
      sampleRate: 16000,
      durationMs: 100,
      speechMs: 100
    });
    const blob = new Blob([bytes], { type: 'audio/wav' });
    expect(blob.size).toBe(4);
  });
});

describe('addNativeVoiceCallLevelListener', () => {
  it('subscribes to the level meter event', async () => {
    const remove = vi.fn(async () => undefined);
    nativePlugin.addListener.mockImplementation(async (eventName: string, listener: unknown) => {
      expect(eventName).toBe('level');
      expect(typeof listener).toBe('function');
      return { remove };
    });

    const handle = await addNativeVoiceCallLevelListener(() => undefined);
    expect(nativePlugin.addListener).toHaveBeenCalledTimes(1);
    expect(handle.remove).toBe(remove);
  });
});

describe('cancelNativeVoiceCallTurn', () => {
  it('says whether the in-flight turn should be kept or thrown away', async () => {
    await cancelNativeVoiceCallTurn();
    expect(nativePlugin.cancelTurn).toHaveBeenLastCalledWith({ discard: false });
    await cancelNativeVoiceCallTurn(true);
    expect(nativePlugin.cancelTurn).toHaveBeenLastCalledWith({ discard: true });
  });
});

describe('voice call audio route', () => {
  it('forwards the earpiece/speaker choice and reports what was applied', async () => {
    await expect(setNativeVoiceCallSpeakerphone(true)).resolves.toBe(true);
    expect(nativePlugin.setSpeakerphone).toHaveBeenLastCalledWith({ speakerphone: true });

    await expect(setNativeVoiceCallSpeakerphone(false)).resolves.toBe(false);
    expect(nativePlugin.setSpeakerphone).toHaveBeenLastCalledWith({ speakerphone: false });
  });
});

describe('native call speech playback', () => {
  it('hands the reply to the native player and reports completion', async () => {
    expect(canPlayNativeVoiceCallSpeech()).toBe(true);

    const completed = await playNativeVoiceCallSpeech('AAAA', 'audio/mpeg');
    expect(nativePlugin.playSpeech).toHaveBeenCalledWith({ base64: 'AAAA', mimeType: 'audio/mpeg' });
    expect(completed).toBe(true);
  });

  it('reports an interrupted reply as not completed', async () => {
    nativePlugin.playSpeech.mockResolvedValueOnce({ completed: false });
    await expect(playNativeVoiceCallSpeech('AAAA', 'audio/mpeg')).resolves.toBe(false);
  });

  it('keeps the WebView player on platforms without the plugin', () => {
    capacitorState.platform = 'ios';
    expect(canPlayNativeVoiceCallSpeech()).toBe(false);
  });

  it('passes the interrupt through to the native player', async () => {
    await stopNativeVoiceCallSpeech();
    expect(nativePlugin.stopSpeech).toHaveBeenCalledTimes(1);
  });
});
