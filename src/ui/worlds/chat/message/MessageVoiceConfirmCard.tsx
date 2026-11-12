import { useI18n } from '../../../../i18n';

type MessageVoiceConfirmCardProps = {
  /** 发起申请的是谁，通常是小机自己。 */
  collaboratorName: string;
  /** 估算时长（秒）；拿不到时不显示。 */
  durationSeconds?: number;
  /** 正在合成：两个按钮都禁用，避免重复点。 */
  busy?: boolean;
  onAllow: () => void;
  onDismiss: () => void;
};

function formatEstimate(seconds: number | undefined) {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return '';
  return ` · 约 ${Math.max(1, Math.round(seconds))}″`;
}

/**
 * 小机想发语音时先递上来的确认卡片。
 *
 * 它只是申请：不点「允许」就不会调用合成接口，额度一分不动。
 * 放在聊天流里而不是系统弹窗，免得打断读消息。
 */
export function MessageVoiceConfirmCard({
  collaboratorName,
  durationSeconds,
  busy = false,
  onAllow,
  onDismiss
}: MessageVoiceConfirmCardProps) {
  const { t } = useI18n();
  return (
    <div className="message-voice-confirm" role="group" aria-label={t('chat.voiceMessage.confirmAria')}>
      <div className="message-voice-confirm-copy">
        <p className="message-voice-confirm-title">
          <strong>{collaboratorName}</strong>
          {t('chat.voiceMessage.confirmTitle')}
          {formatEstimate(durationSeconds)}
        </p>
        <p className="message-voice-confirm-detail">{t('chat.voiceMessage.confirmDetail')}</p>
      </div>
      <div className="message-voice-confirm-actions">
        <button type="button" className="message-voice-confirm-btn" onClick={onDismiss} disabled={busy}>
          {t('chat.voiceMessage.confirmDismiss')}
        </button>
        <button
          type="button"
          className="message-voice-confirm-btn is-primary"
          onClick={onAllow}
          disabled={busy}
        >
          {busy ? t('chat.voiceMessage.confirmBusy') : t('chat.voiceMessage.confirmAllow')}
        </button>
      </div>
    </div>
  );
}
