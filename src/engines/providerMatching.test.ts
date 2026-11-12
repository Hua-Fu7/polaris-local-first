import { describe, expect, it } from 'vitest';
import {
  isClaude46Model,
  isClaudeModel,
  isDeepSeekThinkingModel,
  isGatewayBaseUrl,
  isKimiK2InstructModel,
  isKimiK2Model,
  isKimiK2ThinkingModel,
  isSiliconFlowHost,
  parseProviderHost
} from './provider-runtime/internal/providerMatching';

describe('providerMatching', () => {
  it('parses the normalized host from a provider base url', () => {
    expect(parseProviderHost('https://api.SiliconFlow.cn/v1')).toBe('api.siliconflow.cn');
  });

  it('treats relative api paths as gateway routes', () => {
    expect(isGatewayBaseUrl('/api/provider-relay')).toBe(true);
    expect(isGatewayBaseUrl('https://api.openai.com/v1')).toBe(false);
  });

  it('recognizes siliconflow hosts through the shared predicate', () => {
    expect(isSiliconFlowHost('api.siliconflow.cn')).toBe(true);
    expect(isSiliconFlowHost('relay.example.com')).toBe(false);
  });

  it('recognizes claude model families through the shared predicate', () => {
    expect(isClaudeModel('claude-opus-4-6')).toBe(true);
    expect(isClaudeModel('gpt-5-mini')).toBe(false);
    expect(isClaude46Model('claude-sonnet-4.6')).toBe(true);
  });

  it('recognizes kimi k2 variants through the shared predicate', () => {
    expect(isKimiK2Model('moonshotai/Kimi-K2-Instruct')).toBe(true);
    expect(isKimiK2InstructModel('moonshotai/Kimi-K2-Instruct')).toBe(true);
    expect(isKimiK2ThinkingModel('moonshotai/Kimi-K2-Thinking')).toBe(true);
  });

  it('treats deepseek-flash as a V4 thinking model (reasoning + required unsupported)', () => {
    expect(isDeepSeekThinkingModel('deepseek-flash')).toBe(true);
    expect(isDeepSeekThinkingModel('deepseek-v4-flash')).toBe(true);
    expect(isDeepSeekThinkingModel('deepseek-v4-pro')).toBe(true);
    expect(isDeepSeekThinkingModel('deepseek-reasoner')).toBe(true);
    // 非思考模型 deepseek-chat（V3）不受影响。
    expect(isDeepSeekThinkingModel('deepseek-chat')).toBe(false);
  });
});
