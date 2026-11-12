import type { ChatMessage } from '../../types/domain';

export type MessageTurnRange = {
  /** 这条用户消息在数组里的位置。 */
  start: number;
  /** 下一条用户消息的位置；没有就是数组末尾。`start` 到 `end` 之间是本轮引出的全部回答。 */
  end: number;
};

/**
 * 找出「这一轮」在消息数组里占的区间。
 *
 * 一轮 = 一条用户消息 + 它引出的全部回答（助手、工具、系统提示都算），
 * 到下一条用户消息之前为止。所以删掉这个区间是从中间挖一段走，后面的轮次
 * 原样保留——这也是确认弹窗里那句「之后的对话会保留」的含义。
 *
 * 传进来的 messageId 不是用户消息（或压根不在这条会话里）时返回 `null`，
 * 调用方据此放弃删除。
 */
export function resolveMessageTurnRange(
  messages: ChatMessage[],
  messageId: string
): MessageTurnRange | null {
  const start = messages.findIndex((candidate) => candidate.id === messageId);
  if (start === -1) return null;
  if (messages[start]?.role !== 'user') return null;

  let end = messages.length;
  for (let index = start + 1; index < messages.length; index += 1) {
    const candidate = messages[index];
    if (candidate.role === 'user' && !candidate.toolInvocation) {
      end = index;
      break;
    }
  }

  return { start, end };
}

/** 按上面的区间把这一轮从数组里挖掉。区间问不出来的话原样返回。 */
export function removeMessageTurn(messages: ChatMessage[], messageId: string): ChatMessage[] | null {
  const range = resolveMessageTurnRange(messages, messageId);
  if (!range) return null;

  return [...messages.slice(0, range.start), ...messages.slice(range.end)];
}
