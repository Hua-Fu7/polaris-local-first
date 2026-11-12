import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ChatMessage } from '../../../../types/domain';
import { MessageMeta } from './MessageMeta';

function createAssistantMessage(extra?: Partial<ChatMessage>): ChatMessage {
  return {
    id: 'assistant-1',
    role: 'assistant',
    content: '收到',
    timestamp: 1,
    assistantName: '小助手',
    model: 'Polaris',
    thinkingText: '内部思路',
    ...extra
  };
}

describe('MessageMeta', () => {
  it('hides thinking controls when thinking display is disabled', () => {
    const html = renderToStaticMarkup(
      <MessageMeta
        message={createAssistantMessage()}
        fallbackAssistantName="小助手"
        isThinkingActive={false}
        onOpenThinkingSummary={vi.fn()}
        showThinking={false}
      />
    );

    expect(html).toContain('小助手');
    expect(html).toContain('Polaris');
    expect(html).not.toContain('thinking-inline-trigger');
    expect(html).not.toContain('思路摘要');
  });

  it('hides model details when details are disabled', () => {
    const html = renderToStaticMarkup(
      <MessageMeta
        message={createAssistantMessage()}
        fallbackAssistantName="小助手"
        isThinkingActive={false}
        onOpenThinkingSummary={vi.fn()}
        showDetails={false}
        showThinking={false}
      />
    );

    expect(html).toContain('小助手');
    expect(html).not.toContain('Polaris');
  });

  it('renders the thinking entry as a labelled row with clock and chevron', () => {
    const html = renderToStaticMarkup(
      <MessageMeta
        message={createAssistantMessage()}
        fallbackAssistantName="小助手"
        isThinkingActive={false}
        onOpenThinkingSummary={vi.fn()}
      />
    );

    expect(html).toContain('thinking-inline-trigger');
    expect(html).toContain('thinking-inline-label');
    expect(html).toContain('thinking-inline-chevron');
    expect(html).toContain('Thinking...');
  });

  it('keeps the fold row label plain while thinking is active (no flowing excerpt)', () => {
    const html = renderToStaticMarkup(
      <MessageMeta
        message={createAssistantMessage({
          thinkingText: '第一段先确认目标。第二段再想路径。第三段收尾。'
        })}
        fallbackAssistantName="小助手"
        isThinkingActive
        onOpenThinkingSummary={vi.fn()}
      />
    );

    expect(html).toContain('Thinking...');
    expect(html).not.toContain('第三段收尾。');
    expect(html).not.toContain('第一段先确认目标');
  });

  it('marks a row with only thinking so the chevron can stay right', () => {
    const html = renderToStaticMarkup(
      <MessageMeta
        message={createAssistantMessage()}
        fallbackAssistantName="小助手"
        isThinkingActive={false}
        onOpenThinkingSummary={vi.fn()}
        showName={false}
        showModel={false}
        showTokenUsage={false}
      />
    );

    expect(html).toContain('message-identity-row thinking-only');
  });
});
