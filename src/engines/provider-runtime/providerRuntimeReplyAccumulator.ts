import type { ChatTokenUsage } from '../../types/domain';
import type { AssistantReply } from './providerRuntimeTypes';
import { extractDsmlToolCallsFromContent } from './providerRuntimeDsmlToolCalls';

export type OpenAiToolCallAccumulator = {
  id?: string;
  name?: string;
  argumentsText: string;
  providerMetadata?: {
    geminiThoughtSignature?: string;
  };
  sourceSpan?: {
    transport: 'native';
    index: number;
  };
};

export type ReplyAccumulator = {
  content: string;
  thinkingText: string;
  model?: string;
  tokenCount?: number;
  tokenUsage?: ChatTokenUsage;
  toolCalls?: OpenAiToolCallAccumulator[];
  finishReason?: string;
  transportIncomplete?: boolean;
};

export function toAssistantReply(
  target: ReplyAccumulator,
  fallbackModel: string,
  options?: {
    allowThinkingFallbackInContent?: boolean;
  }
): AssistantReply {
  const allowThinkingFallbackInContent = options?.allowThinkingFallbackInContent ?? true;
  const hasVisibleContent = Boolean(target.content.trim());
  const normalizedContent = hasVisibleContent
    ? target.content
    : allowThinkingFallbackInContent
      ? target.thinkingText
      : '';
  const normalizedThinkingText = target.thinkingText.trim() ? target.thinkingText : undefined;

  // DeepSeek-V4 一类把工具调用输出成 DSML 文本而非标准 tool_calls 字段。
  // 标准字段为空时，从正文里把 DSML 块抠出来转成 nativeToolCalls，并剥掉标记，
  // 否则工具永不执行、DSML 代码还会被当成正文显示给用户。
  let resolvedContent = normalizedContent;
  let resolvedToolCalls = target.toolCalls ?? [];
  if (resolvedToolCalls.length === 0 && typeof resolvedContent === 'string' && resolvedContent.includes('DSML')) {
    const dsml = extractDsmlToolCallsFromContent(resolvedContent);
    if (dsml.extracted) {
      resolvedContent = dsml.cleanContent;
      resolvedToolCalls = dsml.toolCalls;
    }
  }

  const nativeToolCalls = resolvedToolCalls
    .filter((call): call is { id?: string; name: string; argumentsText: string; providerMetadata?: { geminiThoughtSignature?: string } } => Boolean(call.name?.trim()))
    .map((call) => ({
      id: call.id,
      name: call.name.trim(),
      argumentsText: call.argumentsText,
      ...(call.providerMetadata ? { providerMetadata: call.providerMetadata } : {})
    }));

  return {
    content: resolvedContent,
    model: target.model || fallbackModel,
    tokenCount: target.tokenCount,
    tokenUsage: target.tokenUsage,
    thinkingText: normalizedThinkingText,
    nativeToolCalls,
    usedNativeToolCalls: nativeToolCalls.length > 0,
    nativeToolCallCount: nativeToolCalls.length,
    finishReason: target.finishReason,
    transportIncomplete: target.transportIncomplete
  };
}
