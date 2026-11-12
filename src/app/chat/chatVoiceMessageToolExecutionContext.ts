import type { ToolContext } from '../../engines/toolExecutorTypes';
import type { Persona } from '../../types/domain';
import { estimateVoiceSeconds, requestVoiceMessage } from './voiceMessageRequestStore';

/**
 * 「想发一条语音」这个工具的落地实现。
 *
 * 这里**只**把申请写进内存 store：不碰 ElevenLabs、不生成音频、不花额度。
 * 真正的合成要等用户在聊天里点「允许」，走的是 `approveVoiceMessage` 那条路。
 */
export function buildVoiceMessageToolExecutionContext(args: {
  personas: Persona[];
  ownerCollaboratorId: string | null | undefined;
  conversationId: string;
}): Pick<ToolContext, 'sendVoiceMessage'> {
  const collaboratorName =
    args.personas.find((persona) => persona.id === args.ownerCollaboratorId)?.name?.trim() || '小机';

  return {
    sendVoiceMessage: (text) => {
      const spokenText = text.trim();
      if (!spokenText) {
        return { ok: false, error: '要念的那句话是空的，没法申请语音。' };
      }

      const request = requestVoiceMessage({
        conversationId: args.conversationId,
        collaboratorId: args.ownerCollaboratorId ?? 'default',
        collaboratorName,
        text: spokenText,
        durationSeconds: estimateVoiceSeconds(spokenText)
      });

      return {
        ok: true,
        summary: '已申请发语音 · 等用户点允许',
        detailText: [
          `要念：${spokenText}`,
          `申请 id：${request.id}`,
          '现在还没有音频：用户点「允许」之后才会合成，点「不用」就什么都不发。别告诉她「已经发好了」。'
        ].join('\n')
      };
    }
  };
}
