import { useEffect, useMemo, useRef, useState } from 'react';
import { useAssetObjectUrl } from '../../../useAssetObjectUrl';

type MessageVoiceBubbleProps = {
  /** 可播放的音频地址（data URL 或已解析的 object URL）。 */
  audioUrl?: string;
  /** 附件在本地资产库里的 id；给了它就不用再传 audioUrl。 */
  assetId?: string;
  /** 已知时长（秒）；没测出来时用音频元数据。 */
  durationSeconds?: number;
  /** 展开后显示的淡色文字；通常是这条回复的正文。 */
  text?: string;
  /** 还在合成：只显示播放键和“生成中”，不画波形和时长。 */
  busy?: boolean;
  label?: string;
  /** 把这个语音的音频存成文件；给了才显示保存键。 */
  onSaveAudio?: () => void;
};

const BAR_COUNT = 42;

function formatClock(seconds: number) {
  const safe = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const minutes = Math.floor(safe / 60);
  return `${minutes}:${String(safe % 60).padStart(2, '0')}`;
}

/** 波形高度只跟下标有关，同一段音频每次渲染都长一样。 */
function useBars() {
  return useMemo(
    () => Array.from({ length: BAR_COUNT }, (_, index) => {
      const t = index / (BAR_COUNT - 1);
      const envelope = Math.sin(t * Math.PI) ** 0.7;
      const group = Math.sin(index * 0.9) * 0.5 + 0.5;
      const isDot = index % 7 === 3 || index % 11 === 8;
      return isDot
        ? { height: 2, isDot: true }
        : { height: Math.round(6 + envelope * (6 + group * 22)), isDot: false };
    }),
    []
  );
}

export function MessageVoiceBubble({
  audioUrl,
  assetId,
  durationSeconds,
  text,
  busy = false,
  label = '语音',
  onSaveAudio
}: MessageVoiceBubbleProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [measured, setMeasured] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const bars = useBars();
  const assetUrl = useAssetObjectUrl(assetId, true);
  const resolvedAudioUrl = audioUrl ?? (assetId ? assetUrl : undefined);

  const total = durationSeconds && durationSeconds > 0 ? durationSeconds : measured;

  useEffect(() => {
    setPlaying(false);
    setElapsed(0);
    setMeasured(0);
  }, [resolvedAudioUrl]);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
      return;
    }
    void audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  };

  if (busy) {
    return (
      <div className="message-voice-bubble is-busy" aria-label={`${label}生成中`}>
        <div className="message-voice-row">
          <button type="button" className="message-voice-play" disabled aria-label="生成中">
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" /></svg>
          </button>
          <span className="message-voice-busy-label">生成中</span>
        </div>
      </div>
    );
  }

  const playedBars = total > 0 ? Math.round((elapsed / total) * BAR_COUNT) : 0;

  return (
    <div className={`message-voice-bubble${expanded ? ' is-expanded' : ''}`} aria-label={label}>
      {resolvedAudioUrl ? (
        <audio
          ref={audioRef}
          src={resolvedAudioUrl}
          preload="metadata"
          onLoadedMetadata={(event) => setMeasured(event.currentTarget.duration || 0)}
          onTimeUpdate={(event) => setElapsed(event.currentTarget.currentTime || 0)}
          onEnded={() => {
            setPlaying(false);
            setElapsed(0);
          }}
        />
      ) : null}
      <div className="message-voice-row">
        <button
          type="button"
          className="message-voice-play"
          onClick={toggle}
          disabled={!resolvedAudioUrl}
          aria-label={playing ? '暂停语音' : '播放语音'}
        >
          {playing ? (
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5h3.2v14H7zM13.8 5H17v14h-3.2z" /></svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" /></svg>
          )}
        </button>
        <div className="message-voice-wave" aria-hidden="true">
          {bars.map((bar, index) => (
            <i
              key={index}
              className={`${bar.isDot ? 'is-dot' : ''}${index < playedBars ? ' is-played' : ''}`.trim()}
              style={{ height: `${bar.height}px` }}
            />
          ))}
        </div>
        <div className="message-voice-meta">
          <span className="message-voice-time">{formatClock(elapsed)}</span>
          {total > 0 ? <span className="message-voice-total">{formatClock(total)}</span> : null}
        </div>
        {text?.trim() ? (
          <button
            type="button"
            className="message-voice-expand"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            aria-label={expanded ? '收起文字' : '展开文字'}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
        ) : null}
        {onSaveAudio ? (
          <button
            type="button"
            className="message-voice-save"
            onClick={onSaveAudio}
            aria-label="保存这段语音"
            title="保存这段语音"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 4v10" />
              <path d="M8 10.5l4 4 4-4" />
              <path d="M5 19h14" />
            </svg>
          </button>
        ) : null}
      </div>
      {expanded && text?.trim() ? <p className="message-voice-transcript">{text}</p> : null}
    </div>
  );
}
