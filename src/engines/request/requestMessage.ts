import type {
  ChatAttachment,
  ChatCardReference,
  ChatMessage,
  ChatNativeToolCall,
  ToolInvocation
} from '../../types/domain';
import {
  buildProviderFailureRequestContent,
  isProviderFailureDiagnosticMessage
} from '../providerErrorHandling';

export type RequestAttachment = ChatAttachment & { dataUrl?: string };

export type RequestMessage = {
  id: string;
  role: ChatMessage['role'];
  content: string;
  timestamp: number;
  origin?: ChatMessage['origin'];
  requestDelivery?: ChatMessage['requestDelivery'];
  thinkingText?: string;
  attachments?: RequestAttachment[];
  nativeToolCalls?: ChatNativeToolCall[];
  toolInvocation?: ToolInvocation;
  cardReference?: ChatCardReference;
};

function isLocalProviderFailureBubble(message: ChatMessage) {
  return (
    message.role === 'assistant'
    && message.origin === 'assistant-reply'
    && !message.toolInvocation
    && (message.nativeToolCalls?.length ?? 0) === 0
    && !message.providerId
    && !message.providerName
    && !message.model
    && !message.tokenUsage
    && isProviderFailureDiagnosticMessage(message.content)
  );
}

export function toRequestMessage(message: ChatMessage): RequestMessage {
  if (isLocalProviderFailureBubble(message)) {
    return {
      id: message.id,
      role: 'system',
      content: buildProviderFailureRequestContent(message.content),
      timestamp: message.timestamp,
      origin: message.origin
    };
  }

  // requestContent 有的时候会被写成空串（例如失败重试、续写路径），
  // 一旦为空就把真正给用户看的正文拿回来——否则模型会收到一条"空的用户消息"。
  const requestBody = typeof message.requestContent === 'string' && message.requestContent.trim()
    ? message.requestContent
    : message.content;

  return {
    id: message.id,
    role: message.requestRole ?? message.role,
    content: requestBody,
    timestamp: message.timestamp,
    origin: message.origin,
    requestDelivery: message.requestDelivery,
    thinkingText: message.thinkingText,
    attachments: message.attachments as RequestAttachment[] | undefined,
    nativeToolCalls: message.nativeToolCalls,
    toolInvocation: message.toolInvocation,
    cardReference: message.cardReference
  };
}
