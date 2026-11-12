import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { base64ToBytes } from './nativeBase64';

/**
 * Native microphone capture for voice call mode.
 *
 * WebView getUserMedia is not usable here: on some vendor ROMs WebRTC forces the
 * capture to VOICE_COMMUNICATION and the audio callback Chromium installs returns
 * -1, after which the WebView render process segfaults and takes the whole app
 * down. Capturing in Java never touches the WebView audio stack.
 */

export type NativeVoiceCallTurn = {
  /** Base64 WAV (16kHz mono PCM16). */
  base64: string;
  mimeType: string;
  sampleRate: number;
  durationMs: number;
  speechMs: number;
};

type NativeVoiceCallRecorderPlugin = {
  startTurn(options: {
    silenceMs?: number;
    minSpeechMs?: number;
    maxTurnMs?: number;
    noSpeechMs?: number;
  }): Promise<NativeVoiceCallTurn>;
  /** `discard` drops the whole turn instead of keeping what was already said. */
  cancelTurn(options: { discard?: boolean }): Promise<void>;
  /** Switches the call output between the earpiece (false) and the speaker (true). */
  setSpeakerphone(options: { speakerphone: boolean }): Promise<{ speakerphone: boolean }>;
  /**
   * Plays one reply. Resolves when it finishes, or as soon as it is interrupted —
   * `completed` says which.
   */
  playSpeech(options: { base64: string; mimeType: string }): Promise<{ completed: boolean }>;
  /** Cuts the reply short. A no-op when nothing is playing. */
  stopSpeech(): Promise<void>;
  release(): Promise<void>;
  addListener(
    eventName: 'level',
    listener: (event: { level: number; speaking: boolean }) => void
  ): Promise<PluginListenerHandle>;
};

const VoiceCallRecorderNative = registerPlugin<NativeVoiceCallRecorderPlugin>('VoiceCallRecorder');

/**
 * Android only for now: the plugin is registered by MainActivity, so anywhere
 * else (web preview, desktop) the WebView recorder still handles capture.
 */
export function canUseNativeVoiceCallRecorder(): boolean {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('VoiceCallRecorder')) return false;
  return Capacitor.getPlatform() === 'android';
}

export async function recordNativeVoiceCallTurn(options: {
  silenceMs?: number;
  minSpeechMs?: number;
  maxTurnMs?: number;
  noSpeechMs?: number;
}): Promise<NativeVoiceCallTurn> {
  return VoiceCallRecorderNative.startTurn(options);
}

export async function cancelNativeVoiceCallTurn(discard = false): Promise<void> {
  await VoiceCallRecorderNative.cancelTurn({ discard });
}

/**
 * Only Android can move the call between the earpiece and the speaker: a WebView
 * `<audio>` element plays on the media route, which the call route switch does not
 * touch, so on the web the browser owns this and the UI hides the key.
 */
export async function setNativeVoiceCallSpeakerphone(speakerphone: boolean): Promise<boolean> {
  const result = await VoiceCallRecorderNative.setSpeakerphone({ speakerphone });
  return result?.speakerphone ?? speakerphone;
}

/**
 * Android plays replies through the native call route instead of an `<audio>`
 * element, which is the only way the speaker/earpiece switch can apply to them.
 */
export function canPlayNativeVoiceCallSpeech(): boolean {
  return canUseNativeVoiceCallRecorder();
}

/** Resolves true when the reply played out, false when it was interrupted. */
export async function playNativeVoiceCallSpeech(
  base64: string,
  mimeType: string
): Promise<boolean> {
  const result = await VoiceCallRecorderNative.playSpeech({ base64, mimeType });
  return result?.completed !== false;
}

export async function stopNativeVoiceCallSpeech(): Promise<void> {
  await VoiceCallRecorderNative.stopSpeech();
}

export async function releaseNativeVoiceCallRecorder(): Promise<void> {
  await VoiceCallRecorderNative.release();
}

export async function addNativeVoiceCallLevelListener(
  listener: (event: { level: number; speaking: boolean }) => void
): Promise<PluginListenerHandle> {
  return VoiceCallRecorderNative.addListener('level', listener);
}

/**
 * Decodes the turn into bytes. The copy is deliberate: `Blob` only accepts
 * ArrayBuffer-backed views, while the decoder hands back the wider
 * ArrayBufferLike flavour.
 */
export function nativeVoiceCallTurnToBytes(turn: NativeVoiceCallTurn): Uint8Array<ArrayBuffer> {
  return new Uint8Array(base64ToBytes(turn.base64));
}
