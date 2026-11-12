import { describe, expect, it } from 'vitest';
import { parseAssistantToolAction } from './assistantToolProtocolActionParser';
import { isPolarisNativeToolVisible } from './toolVisibility';
import { POLARIS_TOOL_REGISTRY_BY_NAME } from './toolRegistry';
import { buildAssistantToolPrompt } from './assistantToolProtocolPrompt';
import { resolveAssistantToolRequestTools } from './assistantToolProtocolRequestTools';

function chatContext(enabledToolGroups: Record<string, boolean> = { voice: true }) {
  return {
    themeToolMode: 'stable' as const,
    themeContextMode: 'none' as const,
    toolEnforcementMode: 'normal' as const,
    modelTier: 'medium' as const,
    themePreviewActive: false,
    enabledToolGroups,
    activeCard: null,
    visibleCards: []
  };
}

describe('sendVoiceMessage protocol wiring', () => {
  it('parses the line the collaborator wants to say', () => {
    const result = parseAssistantToolAction({
      kind: 'sendVoiceMessage',
      text: '晚安，早点睡'
    });

    expect(result.issue).toBeUndefined();
    expect(result.action).toEqual({
      kind: 'sendVoiceMessage',
      text: '晚安，早点睡',
      targetLabel: undefined
    });
  });

  it('accepts content as a fallback field name', () => {
    const result = parseAssistantToolAction({
      kind: 'sendVoiceMessage',
      content: '  抱一下  '
    });

    expect(result.action).toEqual({
      kind: 'sendVoiceMessage',
      text: '抱一下',
      targetLabel: undefined
    });
  });

  it('rejects a voice request with nothing to say', () => {
    const result = parseAssistantToolAction({ kind: 'sendVoiceMessage' });

    expect(result.action).toBeNull();
    expect(result.issue).toContain('text');
  });

  it('stays available even when the conversation has no attachments', () => {
    // 申请语音跟附件无关：语音分组有自己的开关，不该被“没有附件”挡掉。
    expect(isPolarisNativeToolVisible(POLARIS_TOOL_REGISTRY_BY_NAME.sendVoiceMessage, {
      enabledToolGroups: { voice: true },
      attachmentSnapshot: { available: [] }
    } as never)).toBe(true);
    expect(isPolarisNativeToolVisible(POLARIS_TOOL_REGISTRY_BY_NAME.sendVoiceMessage, {
      enabledToolGroups: { voice: false },
      attachmentSnapshot: { available: [] }
    } as never)).toBe(false);
  });

  it('reaches the model as a native tool with the wait-for-approval rule', () => {
    const toolNames = resolveAssistantToolRequestTools(chatContext() as never).tools
      .map((tool) => tool.function.name);
    const prompt = buildAssistantToolPrompt(chatContext() as never);

    expect(toolNames).toContain('sendVoiceMessage');
    expect(prompt).toContain('sendVoiceMessage');
    expect(prompt).toContain('用户点「允许」之后才会合成');
  });

  it('carries rules that tell the model to wait for the user', () => {
    const rules = POLARIS_TOOL_REGISTRY_BY_NAME.sendVoiceMessage.rules?.join('\n') ?? '';

    expect(rules).toContain('用户点「允许」之后才会合成');
    expect(rules).toContain('不要自己合成音频');
  });
});
