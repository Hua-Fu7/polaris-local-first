import { describe, expect, it } from 'vitest';
import { resolveOpenAiToolChoice } from './sampling';
import type { ProviderCapability } from '../providerCapability';

/**
 * 判断层（来电接/拒、主动决策）要求「必须调用工具」，但第三方模型
 * （MiniMax / SiliconFlow / OpenRouter 等）的 capability 白名单只给 `auto`。
 * `forceRequired` 必须能穿透这个白名单，把 `tool_choice` 强制成 `required`，
 * 否则模型会改用自然语言表态，拒接就退化成"从话里猜"。
 *
 * 但 DeepSeek 思考模型（deepseek-v4 等）在思考模式下 `tool_choice: required` 会 400，
 * `supportsRequiredChoice` 为 false —— 这时 `forceRequired` 绝不能硬发 required。
 */

function capabilityWithTools(
  tools: Partial<ProviderCapability['tools']>
): ProviderCapability {
  return {
    tools
  } as unknown as ProviderCapability;
}

describe('resolveOpenAiToolChoice', () => {
  it('auto 白名单下默认把 required 降级成 auto', () => {
    expect(
      resolveOpenAiToolChoice('required', capabilityWithTools({ choiceControl: 'auto' }))
    ).toBe('auto');
  });

  it('forceRequired 在 provider 支持 required 时穿透 auto 白名单，强制 required', () => {
    expect(
      resolveOpenAiToolChoice('required', capabilityWithTools({
        choiceControl: 'auto',
        supportsRequiredChoice: true
      }), { forceRequired: true })
    ).toBe('required');
  });

  it('DeepSeek 思考模型（auto 且不支持 required）forceRequired 不硬发，仍降级为 auto', () => {
    expect(
      resolveOpenAiToolChoice('required', capabilityWithTools({
        choiceControl: 'auto',
        supportsRequiredChoice: false
      }), { forceRequired: true })
    ).toBe('auto');
  });

  it('choiceControl=none 时 forceRequired 也不该硬发（provider 完全禁用 tool_choice）', () => {
    expect(
      resolveOpenAiToolChoice('required', capabilityWithTools({ choiceControl: 'none' }), { forceRequired: true })
    ).toBeUndefined();
  });

  it('non-required 的 toolChoice 不受 forceRequired 影响', () => {
    expect(
      resolveOpenAiToolChoice('auto', capabilityWithTools({ choiceControl: 'auto' }), { forceRequired: true })
    ).toBe('auto');
  });

  it('required 白名单下 forceRequired 无副作用，仍是 required', () => {
    expect(
      resolveOpenAiToolChoice('required', capabilityWithTools({ choiceControl: 'required' }), { forceRequired: true })
    ).toBe('required');
  });
});
