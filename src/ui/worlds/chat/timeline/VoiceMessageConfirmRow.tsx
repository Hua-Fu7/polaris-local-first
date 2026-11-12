import { useState } from 'react';
import type { VoiceMessageRequest } from '../../../../app/chat/voiceMessageRequestStore';
import { MessageVoiceConfirmCard } from '../message/MessageVoiceConfirmCard';

type VoiceMessageConfirmRowProps = {
  request: VoiceMessageRequest;
  /** 点「允许」：进合成。合成期间卡片自己按住两个按钮。 */
  onAllow: (request: VoiceMessageRequest) => Promise<void> | void;
  /** 点「不用」：把申请扔掉，一分额度都不花。 */
  onDismiss: (request: VoiceMessageRequest) => void;
};

/**
 * 聊天流里的那一块「小机想发语音」申请。
 *
 * 申请本身不花钱，只有点了「允许」才进合成；合成中两个按钮一起禁用，
 * 免得连点两下把同一句话合成两遍。
 */
export function VoiceMessageConfirmRow({
  request,
  onAllow,
  onDismiss
}: VoiceMessageConfirmRowProps) {
  const [busy, setBusy] = useState(false);

  const allow = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onAllow(request);
    } catch {
      // 合成失败由上层报到命令状态里；这里只负责把按钮放开。
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="message-voice-confirm-row">
      <MessageVoiceConfirmCard
        collaboratorName={request.collaboratorName}
        durationSeconds={request.durationSeconds}
        busy={busy}
        onAllow={() => { void allow(); }}
        onDismiss={() => onDismiss(request)}
      />
    </div>
  );
}
