import { postNativeProactiveReplyNotification } from '../../native/localTriggerNotifications';
import { useChatStore } from '../../stores/chatStore';
import { buildReplyPreview } from './proactiveReplyNotification';

/**
 * 回复刚落盘时给用户的反馈：**只弹通知**，不震动。
 *
 * 震动去过一版，静音模式下基本没感觉，用户说去掉。
 * 通知只在「你不在这个对话里」时弹，避免在聊天页里还弹一条。
 */
export function shouldNotifyReplyCompletion(args: {
  appVisible: boolean;
  viewingConversation: boolean;
}): boolean {
  return !args.appVisible || !args.viewingConversation;
}

function isAppVisible() {
  if (typeof document === 'undefined') return true;
  return document.visibilityState !== 'hidden';
}

export async function deliverReplyCompletionFeedback(conversationId: string): Promise<void> {
  const chat = useChatStore.getState();
  const conversation = chat.conversations.find((item) => item.id === conversationId);
  if (!conversation) return;

  const reply = [...conversation.messages]
    .reverse()
    .find((message) => message.role === 'assistant' && !message.toolInvocation && message.content.trim());
  if (!reply) return;

  if (!shouldNotifyReplyCompletion({
    appVisible: isAppVisible(),
    viewingConversation: chat.activeConversationId === conversationId
  })) {
    return;
  }

  const preview = buildReplyPreview(reply.content);
  if (!preview) return;

  await postNativeProactiveReplyNotification({
    collaboratorId: conversation.collaboratorId ?? 'default',
    collaboratorName: reply.assistantName || '小机',
    conversationId,
    preview
  });
}
