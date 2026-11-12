import type { CSSProperties } from 'react';
import { useI18n } from '../../../../i18n';
import { useSpaceStore } from '../../../../stores/spaceStore';
import { Icon } from '../../../Icon';

type IncomingCallOverlayProps = {
  /** 打过来的那个人。名字拿不到时调用方会给一个兜底称呼。 */
  name: string;
  /** 可选的一行理由，例如「想跟你说件事」。 */
  reason: string;
  onAccept: () => void;
  onDecline: () => void;
};

/** Three staggered puffs, same rhythm as the outgoing call screen. */
const RIPPLE_COUNT = 3;

/**
 * 对方打过来时的来电界面。
 *
 * 方向反过来的一通电话：拨号的是协作者，用户才是接的人。所以这一屏没有相位文案、
 * 没有静音和免提 —— 麦克风还没开，这些键按了不会有任何反应，摆在那里只会让人以为坏了。
 * 只有两个键：拒接和接听。
 *
 * 刻意不做震动和响铃：用户明确排除过。这一屏只是「看得见」，声音由用户接听之后再说。
 */
export function IncomingCallOverlay({ name, reason, onAccept, onDecline }: IncomingCallOverlayProps) {
  const { t } = useI18n();
  // Undefined lets the stylesheet fall back to its grey default.
  const orbColor = useSpaceStore((state) => state.customization.voiceCallOrbColor) ?? undefined;

  return (
    <div
      className="voice-call-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={t('chat.voiceCall.incomingAria', { name })}
      style={{ '--voice-call-orb-color': orbColor } as CSSProperties}
    >
      <div className="voice-call-stage">
        <div className="voice-call-orb phase-incoming">
          <div className="voice-call-ripples" aria-hidden="true">
            {Array.from({ length: RIPPLE_COUNT }, (_, index) => (
              <span key={index} />
            ))}
          </div>
          <div className="voice-call-core" aria-hidden="true" />
        </div>

        {reason ? (
          <div className="voice-call-said">
            <span className="voice-call-said-dot" aria-hidden="true" />
            <p>{reason}</p>
          </div>
        ) : null}

        {/* 名字本身就是这一屏的主角：谁打来的，比什么都重要。 */}
        <p className="voice-call-phase">{name}</p>
        <p className="voice-call-hint">{t('chat.voiceCall.incomingHint')}</p>
      </div>

      <div className="voice-call-actions voice-call-actions-answer">
        <button type="button" className="voice-call-answer-key voice-call-decline" onClick={onDecline}>
          <span className="voice-call-answer-face">
            <Icon name="hangup" size={26} />
          </span>
          <span className="voice-call-key-label">{t('chat.voiceCall.decline')}</span>
        </button>

        <button type="button" className="voice-call-answer-key voice-call-accept" onClick={onAccept}>
          <span className="voice-call-answer-face">
            <Icon name="answer" size={26} />
          </span>
          <span className="voice-call-key-label">{t('chat.voiceCall.answer')}</span>
        </button>
      </div>
    </div>
  );
}
