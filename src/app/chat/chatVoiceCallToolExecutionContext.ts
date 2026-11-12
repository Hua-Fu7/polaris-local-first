import type { ToolContext } from '../../engines/toolExecutorTypes';
import type { Persona } from '../../types/domain';

/**
 * 语音通话已下线。
 *
 * 界面入口（附件面板里的「通话」）和来电浮层都已经撤掉，这个工具本身也不再
 * 产生任何副作用：不投来电、不发通知、不碰麦克风。保留空实现只是为了满足
 * `ToolContext` 的契约，等通话相关文件整体删除时会一起消失。
 */
export function buildVoiceCallToolExecutionContext(_args: {
  personas: Persona[];
  ownerCollaboratorId: string | null | undefined;
  conversationId: string;
}): Pick<ToolContext, 'startVoiceCall' | 'hangUp'> {
  const offline = {
    ok: false as const,
    error: '语音通话已经下线了，现在不能再打电话。想说话就直接发文字，或者等我发语音条。'
  };
  return {
    startVoiceCall: () => offline,
    hangUp: () => offline
  };
}
