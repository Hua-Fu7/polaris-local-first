import { useEffect, useState, type CSSProperties } from 'react';
import { useI18n } from '../../../../i18n';
import { useSpaceStore } from '../../../../stores/spaceStore';
import { Icon } from '../../../Icon';
import type { VoiceCallController, VoiceCallPhase } from './useVoiceCall';

type VoiceCallOverlayProps = {
  call: VoiceCallController;
};

/** Three staggered rings so a new one leaves the centre every third of a cycle. */
const RIPPLE_COUNT = 3;

function phaseKey(phase: VoiceCallPhase) {
  switch (phase) {
    case 'ringing':
      return 'chat.voiceCall.phase.ringing';
    case 'starting':
      return 'chat.voiceCall.phase.starting';
    /*
     * 转写不配文案。
     *
     * 这一步常常只有几百毫秒，一行字刚出现就消失，读起来像界面在抖；而且
     * 「正在把你的话转成文字」只是把机器内部的动作念给用户听，他本来就知道
     * 自己刚说了话。转完的文字马上就出现在「你说」那一行，那才是他要看的反馈。
     */
    case 'transcribing':
      return null;
    case 'thinking':
      return 'chat.voiceCall.phase.thinking';
    case 'speaking':
      return 'chat.voiceCall.phase.speaking';
    case 'declined':
      return 'chat.voiceCall.phase.declined';
    case 'unreachable':
      return 'chat.voiceCall.phase.unreachable';
    case 'error':
      return 'chat.voiceCall.phase.error';
    case 'listening':
    default:
      return 'chat.voiceCall.phase.listening';
  }
}

/** 拨出后还没接通的三段：麦克风没开，键位也该像拨号盘那样只剩挂断。 */
function isPendingPhase(phase: VoiceCallPhase) {
  return phase === 'ringing' || phase === 'declined' || phase === 'unreachable';
}

export function VoiceCallOverlay({ call }: VoiceCallOverlayProps) {
  const { t } = useI18n();
  // Undefined lets the stylesheet fall back to its grey default.
  const orbColor = useSpaceStore((state) => state.customization.voiceCallOrbColor) ?? undefined;
  const [keyboardInset, setKeyboardInset] = useState(0);
  const listening = call.phase === 'listening';
  const pending = isPendingPhase(call.phase);
  // The core swells with the mic so the orb reads as "hearing you" while you
  // talk. Muted means the mic is off, so there is nothing to swell with.
  const level = listening && !call.muted ? Math.max(call.level, 0.04) : 0;
  const setupMessage = !call.transcriptionReady
    ? t('chat.voiceCall.notConfiguredTranscription')
    : !call.playbackReady
      ? t('chat.voiceCall.notConfiguredPlayback')
      : null;
  /*
   * One card, two possible origins: the spoken reply during a call, or the line
   * the assistant left behind when it refused the call. The refusal itself is
   * announced by the phase line below ("X declined your call") — this card only
   * carries the assistant's own words, in its own voice, so the two never
   * repeat the same sentence.
   */
  const words = call.phase === 'declined'
    ? (call.declineLine?.trim() ?? '')
    : call.replyText;
  /*
   * 没有文案的阶段（目前只有转写）留一个空字符串，而不是干脆不渲染那行字：
   * 整块界面是竖向居中的，少一行会让 orb 和键位跟着跳一下。
   */
  const phaseLabel = (() => {
    const key = phaseKey(call.phase);
    if (!key) return '';
    return t(key, { name: call.collaboratorName || t('chat.voiceCall.someone') });
  })();
  const draftReady = call.draft.trim().length > 0;

  /*
   * 软键盘会不会把输入条盖住，取决于系统怎么处理它：这个 App 在 Keyboard 插件里
   * 配的是 `resize: none`，WebView 自己不会缩，于是键盘可能直接浮在底部键位上面。
   * 所以这里量出「实际被遮住的高度」把那一条抬起来：
   *
   *   innerHeight - visualViewport.height - offsetTop
   *
   * 系统若选择了缩窗口（adjustResize）而不是浮在内容上，等式右侧两项会一起变小，
   * 差值是 0 —— 这段就等于没写。两种行为都对，拿不到 visualViewport 时也一样。
   */
  useEffect(() => {
    if (!call.keyboardOpen) {
      setKeyboardInset(0);
      return;
    }
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => {
      const hidden = window.innerHeight - viewport.height - viewport.offsetTop;
      setKeyboardInset(hidden > 1 ? Math.round(hidden) : 0);
    };
    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
    };
  }, [call.keyboardOpen]);

  return (
    <div
      className={`voice-call-overlay${call.keyboardOpen ? ' keyboard-open' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={t('chat.voiceCall.title')}
      style={{
        '--voice-call-orb-color': orbColor,
        '--voice-call-keyboard-inset': `${keyboardInset}px`
      } as CSSProperties}
    >
      <div className="voice-call-stage">
        {/*
          打开键盘时 orb 整个退场，而不是被 CSS 藏起来。
          软键盘要吃走屏幕下半截，240px 的固定方块压不下去，留着它整块界面就会
          溢出；而且打字的时候它也没什么可看的，屏幕上留住「它说」那句话、
          输入条和键位就够了。不渲染也顺带停掉它的呼吸动画。
        */}
        {call.keyboardOpen ? null : (
          <div
            className={`voice-call-orb phase-${call.phase}`}
            style={{ '--voice-call-level': level.toFixed(3) } as CSSProperties}
          >
            <div className="voice-call-ripples" aria-hidden="true">
              {Array.from({ length: RIPPLE_COUNT }, (_, index) => (
                <span key={index} />
              ))}
            </div>
            <div className="voice-call-core" aria-hidden="true" />
          </div>
        )}

        {words ? (
          <div className="voice-call-said">
            <span className="voice-call-said-dot" aria-hidden="true" />
            <p>{words}</p>
          </div>
        ) : null}

        <p className="voice-call-phase">
          {phaseLabel}
        </p>
        {call.phase === 'ringing' ? <p className="voice-call-hint">{t('chat.voiceCall.ringingHint')}</p> : null}
        {listening && !call.muted && !call.keyboardOpen ? <p className="voice-call-hint">{t('chat.voiceCall.listeningHint')}</p> : null}
        {call.phase === 'unreachable' ? (
          <p className="voice-call-hint">{t('chat.voiceCall.unreachableHint')}</p>
        ) : null}
        {/* Kept out of the phase line: the reply can still be playing while the
            caller has already muted, and both facts matter. */}
        {call.muted ? <p className="voice-call-muted">{t('chat.voiceCall.mutedNotice')}</p> : null}
        {call.heardText ? (
          <p className="voice-call-heard">
            <span>{t('chat.voiceCall.heardLabel')}</span>
            {call.heardText}
          </p>
        ) : null}
        {call.error ? <p className="voice-call-error">{call.error}</p> : null}
        {setupMessage ? <p className="voice-call-setup">{setupMessage}</p> : null}
      </div>

      {/*
        输入条和键位同属底部那一块：软键盘弹起时它俩一起被顶上去，中间隔着的
        只是 14px 的间距，所以拿一个 flex 容器兜住，而不是让 overlay 直接管两张
        互不相干的横排。
      */}
      <div className="voice-call-dock">
        {call.keyboardOpen ? (
          <div className="voice-call-composer">
            <input
              type="text"
              className="voice-call-composer-input"
              value={call.draft}
              onChange={(event) => call.setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  call.sendDraft();
                }
              }}
              placeholder={t('chat.voiceCall.keyboardPlaceholder')}
              aria-label={t('chat.voiceCall.keyboardInput')}
              enterKeyHint="send"
              autoFocus
            />
            <button
              type="button"
              className="voice-call-composer-send"
              aria-label={t('chat.voiceCall.keyboardSend')}
              disabled={!draftReady}
              onClick={call.sendDraft}
            >
              <Icon name="send" size={20} />
            </button>
          </div>
        ) : null}

        <div className="voice-call-actions">
          {/*
            打字键和静音键一样，都要等接通之后才有意义：还没接通时麦克风都没开，
            更谈不上「改用打字」。所以它跟静音、免提一起在 pending 时退场。
          */}
          {pending ? null : (
            <button
              type="button"
              className={`voice-call-key${call.keyboardOpen ? ' on' : ''}`}
              aria-pressed={call.keyboardOpen}
              onClick={call.keyboardOpen ? call.closeKeyboard : call.openKeyboard}
            >
              <span className="voice-call-key-face">
                <Icon name="keyboard" size={22} />
              </span>
              <span className="voice-call-key-label">{t('chat.voiceCall.keyboard')}</span>
            </button>
          )}

          {/*
            振铃和未接通时只剩挂断键，跟拨号盘一样：麦克风没开，静音和免提都还没有
            可作用的对象，摆在那里只会让人以为按了没用。
          */}
          {pending ? null : (
            <button
              type="button"
              className={`voice-call-key${call.muted ? ' on' : ''}`}
              aria-pressed={call.muted}
              onClick={call.toggleMute}
            >
              <span className="voice-call-key-face">
                <Icon name={call.muted ? 'micOff' : 'mic'} size={22} />
              </span>
              <span className="voice-call-key-label">
                {t(call.muted ? 'chat.voiceCall.unmute' : 'chat.voiceCall.mute')}
              </span>
            </button>
          )}

          {call.speakerphoneSupported && !pending ? (
            <button
              type="button"
              className={`voice-call-key${call.speakerphone ? ' on' : ''}`}
              aria-pressed={call.speakerphone}
              onClick={call.toggleSpeakerphone}
            >
              <span className="voice-call-key-face">
                <Icon name="speaker" size={22} />
              </span>
              <span className="voice-call-key-label">{t('chat.voiceCall.speakerphone')}</span>
            </button>
          ) : null}

          {/*
            Only while the assistant is talking. A reserved-but-hidden slot kept a
            hole in the middle of the row for the whole call, and an always-visible
            dead key looked broken; the row simply grows by one key instead.
          */}
          {call.phase === 'speaking' ? (
            <button type="button" className="voice-call-key" onClick={call.interrupt}>
              <span className="voice-call-key-face">
                <Icon name="pause" size={22} />
              </span>
              <span className="voice-call-key-label">{t('chat.voiceCall.interrupt')}</span>
            </button>
          ) : null}

          {/* The red receiver is the one key that needs no caption. */}
          <button
            type="button"
            className="voice-call-end"
            aria-label={t('chat.voiceCall.end')}
            onClick={call.end}
          >
            <Icon name="hangup" size={26} />
          </button>
        </div>
      </div>
    </div>
  );
}
