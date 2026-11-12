import type { PluginListenerHandle } from '@capacitor/core';
import {
  VoiceCallRecorder,
  VoiceCallRecorderError,
  type VoiceCallRecorderOptions,
  type VoiceCallRecording
} from './voiceCallRecorder';
import {
  addNativeVoiceCallLevelListener,
  canUseNativeVoiceCallRecorder,
  cancelNativeVoiceCallTurn,
  nativeVoiceCallTurnToBytes,
  recordNativeVoiceCallTurn,
  releaseNativeVoiceCallRecorder,
  setNativeVoiceCallSpeakerphone
} from '../../native/voiceCallRecorder';

/**
 * The call loop only cares about "record one turn, hands free". How the audio is
 * actually captured is platform business, so it picks the implementation here
 * instead of inside the hook.
 *
 * Android uses the native AudioRecord plugin. Everything else keeps the WebView
 * recorder, which is fine on desktop browsers and is what the web preview uses.
 */

export type VoiceCallRecorderLike = {
  /** Warms up the microphone once so later turns start instantly. */
  prime(): Promise<void>;
  recordTurn(options?: VoiceCallRecorderOptions): Promise<VoiceCallRecording>;
  /** `discard` throws the in-flight turn away instead of keeping what was said. */
  cancel(options?: { discard?: boolean }): void;
  release(): void;
  /**
   * Earpiece (false) or speaker (true). A no-op where the platform routes output
   * itself — see `canControlVoiceCallRoute`.
   */
  setSpeakerphone(speakerphone: boolean): Promise<void>;
};

export type VoiceCallRecorderFactoryOptions = {
  /**
   * WebView fallback only: some speech-to-text vendors whitelist m4a but not the
   * WebM container Chromium records by default.
   */
  preferMp4?: boolean;
};

function readNativeErrorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return '';
}

function toVoiceCallRecorderError(error: unknown): Error {
  if (error instanceof VoiceCallRecorderError) return error;
  const message = error instanceof Error ? error.message : String(error ?? '');
  const code = readNativeErrorCode(error);
  if (code === 'permission-denied') return new VoiceCallRecorderError('permission-denied', message);
  if (code === 'no-microphone' || code === 'capture-failed') {
    return new VoiceCallRecorderError('no-microphone', message);
  }
  if (code === 'busy') return new VoiceCallRecorderError('busy', message);
  if (code === 'no-speech') return new VoiceCallRecorderError('no-speech', message);
  if (code === 'muted') return new VoiceCallRecorderError('muted', message);
  return new VoiceCallRecorderError('unsupported', message || 'Recording failed.');
}

class NativeVoiceCallTurnRecorder implements VoiceCallRecorderLike {
  private levelListener: PluginListenerHandle | null = null;
  private onLevel: ((level: number, speaking: boolean) => void) | null = null;

  async prime(): Promise<void> {
    if (this.levelListener) return;
    this.levelListener = await addNativeVoiceCallLevelListener((event) => {
      this.onLevel?.(event.level, event.speaking);
    });
  }

  async recordTurn(options: VoiceCallRecorderOptions = {}): Promise<VoiceCallRecording> {
    this.onLevel = options.onLevel ?? null;
    try {
      const turn = await recordNativeVoiceCallTurn({
        silenceMs: options.silenceMs,
        minSpeechMs: options.minSpeechMs,
        maxTurnMs: options.maxTurnMs,
        noSpeechMs: options.noSpeechMs
      });
      const bytes = nativeVoiceCallTurnToBytes(turn);
      const mimeType = turn.mimeType || 'audio/wav';
      return {
        blob: new Blob([bytes], { type: mimeType }),
        mimeType,
        durationMs: turn.durationMs,
        speechMs: turn.speechMs
      };
    } catch (error) {
      throw toVoiceCallRecorderError(error);
    } finally {
      this.onLevel = null;
    }
  }

  cancel(options: { discard?: boolean } = {}): void {
    this.onLevel = null;
    void cancelNativeVoiceCallTurn(options.discard === true).catch(() => undefined);
  }

  async setSpeakerphone(speakerphone: boolean): Promise<void> {
    await setNativeVoiceCallSpeakerphone(speakerphone);
  }

  release(): void {
    this.onLevel = null;
    const listener = this.levelListener;
    this.levelListener = null;
    if (listener) void listener.remove().catch(() => undefined);
    void releaseNativeVoiceCallRecorder().catch(() => undefined);
  }
}

export function createVoiceCallRecorder(
  options: VoiceCallRecorderFactoryOptions = {}
): VoiceCallRecorderLike {
  if (canUseNativeVoiceCallRecorder()) return new NativeVoiceCallTurnRecorder();
  const web = new VoiceCallRecorder({ preferMp4: options.preferMp4 });
  return {
    prime: () => web.prime(),
    recordTurn: (turnOptions) => web.recordTurn(turnOptions),
    cancel: (cancelOptions) => web.cancel(cancelOptions),
    release: () => web.release(),
    // Desktops and browsers pick their own output device; there is nothing here
    // to switch, which is what `canControlVoiceCallRoute` reports to the UI.
    setSpeakerphone: async () => undefined
  };
}

/** Whether the platform lets the call screen offer an earpiece/speaker switch. */
export function canControlVoiceCallRoute(): boolean {
  return canUseNativeVoiceCallRecorder();
}
