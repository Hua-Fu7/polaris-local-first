import type { ChatMessage } from '../../../../types/domain';

export type TimelineRenderItem = {
  message: ChatMessage;
  toolMessages: ChatMessage[];
  thinkingTimelineMessages: ChatMessage[];
  ownsThinkingTimeline: boolean;
  messageCycleIndex: number | null;
  userBubbleIndex?: number;
  isAssistantContinuation: boolean;
  isTerminalAssistantInUserTurn: boolean;
};

type ThinkingTurnContext = {
  assistantIds: Set<string>;
  ownerId: string | null;
  messages: ChatMessage[];
};

const EMPTY_TOOL_MESSAGES: ChatMessage[] = [];
const EMPTY_THINKING_MESSAGES: ChatMessage[] = [];

function buildToolMessagesByOriginId(messages: ChatMessage[]) {
  const toolMessagesByOriginId = new Map<string, ChatMessage[]>();

  messages.forEach((message) => {
    const isRuntimeToolMessage =
      message.role === 'system'
      && message.origin === 'tool-runtime'
      && Boolean(message.toolInvocation);

    if (!isRuntimeToolMessage) return;

    const originMessageId = message.toolInvocation?.originMessageId?.trim();
    if (!originMessageId) return;

    const bucket = toolMessagesByOriginId.get(originMessageId) ?? [];
    bucket.push(message);
    toolMessagesByOriginId.set(originMessageId, bucket);
  });

  return toolMessagesByOriginId;
}

function buildThinkingTurnContexts(
  messages: ChatMessage[],
  toolMessagesByOriginId: Map<string, ChatMessage[]>
) {
  const contexts: ThinkingTurnContext[] = [];
  const turnIndexByMessageId = new Map<string, number>();
  let currentTurnIndex = -1;

  const beginTurn = () => {
    currentTurnIndex += 1;
    contexts.push({
      assistantIds: new Set<string>(),
      ownerId: null,
      messages: []
    });
  };

  messages.forEach((message) => {
    const isTriggerBoundary = message.role === 'system' && message.origin === 'trigger-runtime';
    const isUserBoundary = message.role === 'user' && !message.toolInvocation;
    if (isTriggerBoundary || isUserBoundary) beginTurn();
    if (currentTurnIndex < 0) beginTurn();

    turnIndexByMessageId.set(message.id, currentTurnIndex);
    if (message.role !== 'assistant' || message.toolInvocation) return;

    const context = contexts[currentTurnIndex];
    if (!context) return;
    context.assistantIds.add(message.id);

    const hasThought = Boolean(message.thinkingText?.trim());
    const hasOwnedTools = toolMessagesByOriginId.has(message.id);
    if (!context.ownerId && (hasThought || hasOwnedTools)) {
      context.ownerId = message.id;
    }
  });

  messages.forEach((message) => {
    const turnIndex = turnIndexByMessageId.get(message.id);
    const context = typeof turnIndex === 'number' ? contexts[turnIndex] : null;
    if (!context) return;

    if (message.role === 'assistant' && !message.toolInvocation && message.thinkingText?.trim()) {
      context.messages.push(message);
      return;
    }

    if (message.role !== 'system' || message.origin !== 'tool-runtime' || !message.toolInvocation) {
      return;
    }

    const originMessageId = message.toolInvocation.originMessageId?.trim();
    if (originMessageId && context.assistantIds.has(originMessageId)) {
      context.messages.push(message);
    }
  });

  return contexts;
}

export function buildTimelineRenderItems(messages: ChatMessage[]): TimelineRenderItem[] {
  const items: TimelineRenderItem[] = [];
  const toolMessagesByOriginId = buildToolMessagesByOriginId(messages);
  const thinkingTurnContexts = buildThinkingTurnContexts(messages, toolMessagesByOriginId);
  let cycleIndex = 0;
  let userBubbleIndex = 0;
  let hasAssistantInCurrentUserTurn = false;

  messages.forEach((message, messageIndex) => {
    if (message.role === 'system' && message.origin === 'trigger-runtime') {
      hasAssistantInCurrentUserTurn = false;
      return;
    }

    const isRuntimeToolMessage =
      message.role === 'system'
      && message.origin === 'tool-runtime'
      && Boolean(message.toolInvocation);
    const originMessageId = message.toolInvocation?.originMessageId?.trim();

    if (isRuntimeToolMessage && originMessageId) {
      return;
    }

    if (message.role === 'user' && !message.toolInvocation) {
      hasAssistantInCurrentUserTurn = false;
    }

    const isCycleMessage = !message.toolInvocation && message.role !== 'system';
    const isUserBubble = message.role === 'user' && !message.toolInvocation;
    const toolMessages =
      message.role === 'assistant' && !message.toolInvocation
        ? toolMessagesByOriginId.get(message.id) ?? EMPTY_TOOL_MESSAGES
        : EMPTY_TOOL_MESSAGES;
    const thinkingTurn = thinkingTurnContexts.find((context) =>
      context.assistantIds.has(message.id)
    );
    const thinkingTimelineMessages = thinkingTurn?.messages ?? EMPTY_THINKING_MESSAGES;
    const ownsThinkingTimeline =
      message.role === 'assistant'
      && !message.toolInvocation
      && thinkingTurn?.ownerId === message.id
      && thinkingTimelineMessages.length > 0;
    const isAssistantContinuation = message.role === 'assistant' && !message.toolInvocation && hasAssistantInCurrentUserTurn;
    const isAssistantMessage = message.role === 'assistant' && !message.toolInvocation;

    let isTerminalAssistantInUserTurn = false;
    if (isAssistantMessage) {
      isTerminalAssistantInUserTurn = true;
      for (let nextIndex = messageIndex + 1; nextIndex < messages.length; nextIndex += 1) {
        const nextMessage = messages[nextIndex];
        const isNextRuntimeToolMessage =
          nextMessage.role === 'system'
          && nextMessage.origin === 'tool-runtime'
          && Boolean(nextMessage.toolInvocation);

        if (isNextRuntimeToolMessage) continue;
        if (nextMessage.role === 'user' && !nextMessage.toolInvocation) break;
        if (nextMessage.role === 'assistant' && !nextMessage.toolInvocation) {
          isTerminalAssistantInUserTurn = false;
        }
        break;
      }
    }

    items.push({
      message,
      toolMessages,
      thinkingTimelineMessages,
      ownsThinkingTimeline,
      messageCycleIndex: isCycleMessage ? cycleIndex++ : null,
      userBubbleIndex: isUserBubble ? userBubbleIndex++ : undefined,
      isAssistantContinuation,
      isTerminalAssistantInUserTurn
    });

    if (message.role === 'assistant' && !message.toolInvocation) {
      hasAssistantInCurrentUserTurn = true;
    }
  });

  return items;
}
