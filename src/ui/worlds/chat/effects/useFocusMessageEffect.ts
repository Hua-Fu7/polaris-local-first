import { useEffect, useLayoutEffect } from 'react';
import type { ChatMessage } from '../../../../types/domain';

const FOCUS_VISIBILITY_PADDING = 28;
/** 高亮留一小会儿再撤：立刻清掉的话 `.focused` 只活一帧，用户等于看不到高亮。 */
const FOCUS_HIGHLIGHT_DURATION_MS = 1600;

export function useFocusMessageEffect(args: {
  focusedMessageId: string | null;
  visibleMessages: ChatMessage[];
  setFocusedMessageTarget: (value: { conversationId: string; messageId: string } | null) => void;
}) {
  const { focusedMessageId, visibleMessages, setFocusedMessageTarget } = args;

  useLayoutEffect(() => {
    if (!focusedMessageId) return;
    if (!visibleMessages.some((message) => message.id === focusedMessageId)) {
      setFocusedMessageTarget(null);
      return;
    }

    let rafId = 0;

    const ensureMessageVisible = () => {
      const container = document.querySelector<HTMLElement>('.chat-flow');
      const target = document.querySelector<HTMLElement>(`[data-message-id="${focusedMessageId}"]`);
      if (!container || !target) {
        setFocusedMessageTarget(null);
        return;
      }

      const containerRect = container.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const visibleTop = containerRect.top + FOCUS_VISIBILITY_PADDING;
      const visibleBottom = containerRect.bottom - FOCUS_VISIBILITY_PADDING;
      const alreadyVisible = targetRect.top >= visibleTop && targetRect.bottom <= visibleBottom;

      if (!alreadyVisible) {
        target.scrollIntoView({ block: 'nearest', behavior: 'auto' });
      }
    };

    rafId = window.requestAnimationFrame(() => {
      ensureMessageVisible();
    });

    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [focusedMessageId, setFocusedMessageTarget, visibleMessages]);

  // 撤高亮单独一条 effect，且只依赖 focusedMessageId：挂在上面那条上的话，
  // visibleMessages 换身份就会把定时器一次次清掉重建，高亮永远撤不下来。
  useEffect(() => {
    if (!focusedMessageId) return;

    const timerId = window.setTimeout(() => {
      setFocusedMessageTarget(null);
    }, FOCUS_HIGHLIGHT_DURATION_MS);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [focusedMessageId, setFocusedMessageTarget]);
}
