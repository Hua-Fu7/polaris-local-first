import type { PolarisToolPromptGroup } from '../../engines/tool-protocol/assistantToolProtocolTypes';
import { POLARIS_TOOLBOX_PROMPT_GROUP_ORDER } from '../../engines/tool-protocol/toolPromptPreferences';

export function getVisibleToolboxPromptGroups({
  desktopLocalAvailable
}: {
  desktopLocalAvailable: boolean;
}): PolarisToolPromptGroup[] {
  return POLARIS_TOOLBOX_PROMPT_GROUP_ORDER.filter((group) => (
    group !== 'theme'
    // 语音通话已下线：入口从工具箱里撤掉，工具本身也返回“已下线”。
    && group !== 'voiceCall'
    && (group !== 'desktop' || desktopLocalAvailable)
  ));
}

export function countEnabledVisibleToolboxGroups(
  preferences: Record<PolarisToolPromptGroup, boolean>,
  options: { desktopLocalAvailable: boolean }
) {
  return getVisibleToolboxPromptGroups(options).filter((group) => preferences[group]).length;
}

