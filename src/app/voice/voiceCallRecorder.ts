/**
 * Voice call recorder: captures a single spoken turn and auto-stops when the
 * speaker goes quiet, so call mode can run hands-free without a stop button.
 *
 * The microphone stream is acquired once and reused across turns, because
 * re-acquiring on every turn both flickers the system mic indicator and adds
 * noticeable latency to each round trip.
 */

export type VoiceCallRecorderOptions = {
  /** How long the speaker must stay quiet before the turn is considered done. */
  silenceMs?: number;
  /** Minimum voiced duration for a turn to count as speech at all. */
  minSpeechMs?: number;
  /** Hard cap on one turn, so a noisy room cannot record forever. */
  maxTurnMs?: number;
  /** Give up when nothing is said within this window. */
  noSpeechMs?: number;
  /** Reports the current input level (0..1) plus whether it reads as speech. */
  onLevel?: (level: number, speaking: boolean) => void;
};

export type VoiceCallRecording = {
  blob: Blob;
  mimeType: string;
  durationMs: number;
  /** Total voiced time; used to reject coughs and door slams. */
  speechMs: number;
};

export type VoiceCallRecorderFailure =
  | 'permission-denied'
  | 'no-microphone'
  | 'unsupported'
  | 'no-speech'
  /** Another turn is still recording. */
  | 'busy'
  /** The turn was cancelled because the caller muted the microphone. */
  | 'muted';

export class VoiceCallRecorderError extends Error {
  readonly kind: VoiceCallRecorderFailure;

  constructor(kind: VoiceCallRecorderFailure, message: string) {
    super(message);
    this.name = 'VoiceCallRecorderError';
    this.kind = kind;
  }
}

const DEFAULT_OPTIONS: Required<Omit<VoiceCallRecorderOptions, 'onLevel'>> = {
  silenceMs: 1100,
  minSpeechMs: 250,
  maxTurnMs: 30000,
  noSpeechMs: 8000
};

const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg'
];

/**
 * MP4/AAC first. Some speech-to-text vendors publish a format whitelist that
 * excludes the WebM container Chromium prefers but includes m4a, so the
 * recorder can be asked to avoid WebM when those vendors are in use.
 */
const MIME_CANDIDATES_MP4_FIRST = [
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg'
];

/** How loud a frame must be, relative to the measured noise floor, to read as speech. */
const SPEECH_RMS_MULTIPLIER = 2.4;
const SPEECH_RMS_FLOOR = 0.012;
/** Frames used to learn the room's noise floor before listening for speech. */
const CALIBRATION_FRAMES = 14;

export function pickRecorderMimeType(options: { preferMp4?: boolean } = {}): string {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = options.preferMp4 ? MIME_CANDIDATES_MP4_FIRST : MIME_CANDIDATES;
  for (const candidate of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(candidate)) return candidate;
    } catch {
      // isTypeSupported throws on some odd WebView builds; just try the next one.
    }
  }
  return '';
}

export function extensionForMimeType(mimeType: string): string {
  const base = (mimeType || '').split(';')[0].trim().toLowerCase();
  if (base === 'audio/webm') return 'webm';
  if (base === 'audio/mp4') return 'm4a';
  if (base === 'audio/ogg') return 'ogg';
  if (base === 'audio/mpeg') return 'mp3';
  if (base === 'audio/wav' || base === 'audio/x-wav') return 'wav';
  return 'webm';
}

export function isVoiceCallRecorderSupported(): boolean {
  return typeof navigator !== 'undefined'
    && Boolean(navigator.mediaDevices?.getUserMedia)
    && typeof MediaRecorder !== 'undefined';
}

export type VoiceCallRecorderSetup = {
  /**
   * Ask for m4a before WebM. Set this when the configured speech-to-text
   * vendor only accepts container formats Chromium does not record by default.
   */
  preferMp4?: boolean;
};

export class VoiceCallRecorder {
  private readonly preferMp4: boolean;
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private samples: Float32Array<ArrayBuffer> | null = null;
  private activeRecorder: MediaRecorder | null = null;
  private rafId: number | null = null;
  /** Set by the in-flight turn so cancel()/release() can settle it. */
  private finishActiveTurn: (() => void) | null = null;
  private cancelled = false;
  /** Cancelled turns are thrown away rather than transcribed. */
  private discarded = false;

  constructor(options: VoiceCallRecorderSetup = {}) {
    this.preferMp4 = options.preferMp4 === true;
  }

  get hasStream(): boolean {
    return Boolean(this.stream && this.stream.getAudioTracks().some((track) => track.readyState === 'live'));
  }

  /** Acquires the microphone once and keeps it warm for subsequent turns. */
  async prime(): Promise<void> {
    if (this.hasStream) return;
    if (!isVoiceCallRecorderSupported()) {
      throw new VoiceCallRecorderError('unsupported', 'This device does not support in-app recording.');
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1
        }
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : '';
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        throw new VoiceCallRecorderError('permission-denied', 'Microphone permission was denied.');
      }
      if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        throw new VoiceCallRecorderError('no-microphone', 'No microphone is available.');
      }
      throw error;
    }

    this.stream = stream;

    const AudioContextCtor = window.AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) {
      // Recording still works; only the level meter and silence detection degrade.
      return;
    }
    this.audioContext = new AudioContextCtor();
    if (this.audioContext.state === 'suspended') {
      void this.audioContext.resume().catch(() => undefined);
    }
    const source = this.audioContext.createMediaStreamSource(stream);
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.6;
    source.connect(this.analyser);
    this.samples = new Float32Array(this.analyser.fftSize);
  }

  /**
   * Records one spoken turn. Resolves as soon as the speaker pauses long enough,
   * or rejects with kind 'no-speech' when the window elapses in silence.
   */
  async recordTurn(options: VoiceCallRecorderOptions = {}): Promise<VoiceCallRecording> {
    const config = { ...DEFAULT_OPTIONS, ...options };
    const onLevel = options.onLevel;
    await this.prime();

    const stream = this.stream;
    if (!stream) {
      throw new VoiceCallRecorderError('no-microphone', 'Microphone stream is unavailable.');
    }

    const mimeType = pickRecorderMimeType({ preferMp4: this.preferMp4 });
    this.cancelled = false;

    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    this.activeRecorder = recorder;
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) chunks.push(event.data);
    };

    const startedAt = Date.now();
    recorder.start(250);

    let speechMs = 0;
    let lastVoiceAt = 0;
    let sawSpeech = false;
    let finished = false;

    return await new Promise<VoiceCallRecording>((resolve, reject) => {
      const finish = (kind: 'ok' | 'no-speech') => {
        if (finished) return;
        finished = true;
        this.finishActiveTurn = null;
        if (this.rafId !== null) {
          window.cancelAnimationFrame(this.rafId);
          this.rafId = null;
        }

        const settle = () => {
          this.activeRecorder = null;
          if (this.discarded) {
            reject(new VoiceCallRecorderError('muted', 'The turn was discarded.'));
            return;
          }
          if (kind === 'no-speech') {
            reject(new VoiceCallRecorderError('no-speech', 'No speech detected.'));
            return;
          }
          resolve({
            blob: new Blob(chunks, { type: recorder.mimeType || mimeType || 'audio/webm' }),
            mimeType: recorder.mimeType || mimeType || 'audio/webm',
            durationMs: Date.now() - startedAt,
            speechMs
          });
        };

        if (recorder.state === 'inactive') {
          settle();
          return;
        }
        recorder.onstop = settle;
        try {
          recorder.stop();
        } catch {
          settle();
        }
      };

      // Lets cancel()/release() end the turn immediately, keeping what was said.
      this.finishActiveTurn = () => finish(sawSpeech ? 'ok' : 'no-speech');

      let frames = 0;
      let noiseFloor = 0;
      let lastFrameAt = Date.now();

      const tick = () => {
        if (finished) return;
        const now = Date.now();
        const elapsed = now - startedAt;
        const delta = Math.min(now - lastFrameAt, 120);
        lastFrameAt = now;

        const level = this.readLevel();
        onLevel?.(level, sawSpeech);

        if (frames < CALIBRATION_FRAMES) {
          frames += 1;
          noiseFloor = Math.max(noiseFloor, level);
        } else {
          const threshold = Math.max(noiseFloor * SPEECH_RMS_MULTIPLIER, SPEECH_RMS_FLOOR);
          if (level > threshold) {
            sawSpeech = true;
            speechMs += delta;
            lastVoiceAt = now;
          }
        }

        if (this.cancelled) {
          finish(sawSpeech ? 'ok' : 'no-speech');
          return;
        }
        if (sawSpeech && speechMs >= config.minSpeechMs && now - lastVoiceAt >= config.silenceMs) {
          finish('ok');
          return;
        }
        if (!sawSpeech && elapsed >= config.noSpeechMs) {
          finish('no-speech');
          return;
        }
        if (elapsed >= config.maxTurnMs) {
          finish(sawSpeech ? 'ok' : 'no-speech');
          return;
        }
        this.rafId = window.requestAnimationFrame(tick);
      };

      this.rafId = window.requestAnimationFrame(tick);
    });
  }

  /**
   * Asks the in-flight turn to wrap up right now, keeping whatever was said.
   * Pass `{ discard: true }` to throw the turn away instead — muting should not
   * send the half sentence that was in flight.
   */
  cancel(options: { discard?: boolean } = {}): void {
    this.discarded = options.discard === true;
    this.cancelled = true;
    this.finishActiveTurn?.();
  }

  /** Stops the microphone and releases every track. Always call when the call ends. */
  release(): void {
    this.cancelled = true;
    this.discarded = false;
    this.finishActiveTurn?.();
    this.finishActiveTurn = null;
    if (this.rafId !== null) {
      window.cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    try {
      this.activeRecorder?.stop();
    } catch {
      // Ignore: stopping an already-stopped recorder is fine.
    }
    this.activeRecorder = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.analyser = null;
    this.samples = null;
    const context = this.audioContext;
    this.audioContext = null;
    if (context && context.state !== 'closed') {
      void context.close().catch(() => undefined);
    }
  }

  private readLevel(): number {
    const analyser = this.analyser;
    const samples = this.samples;
    if (!analyser || !samples) return 0;
    analyser.getFloatTimeDomainData(samples);
    let sum = 0;
    for (let index = 0; index < samples.length; index += 1) {
      sum += samples[index] * samples[index];
    }
    return Math.sqrt(sum / samples.length);
  }
}
