import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MessageVoiceBubble } from './MessageVoiceBubble';

function render(props: Parameters<typeof MessageVoiceBubble>[0]) {
  return renderToStaticMarkup(createElement(MessageVoiceBubble, props));
}

describe('MessageVoiceBubble', () => {
  it('renders a play button and a waveform for a finished voice message', () => {
    const html = render({ audioUrl: 'data:audio/mpeg;base64,AA', text: '在吗' });
    expect(html).toContain('message-voice-bubble');
    expect(html).toContain('message-voice-play');
    expect(html).toContain('message-voice-wave');
    expect(html).toContain('message-voice-expand');
    // 收起时文字不外露，只留在展开后
    expect(html).not.toContain('message-voice-transcript');
  });

  it('shows only the play button and 生成中 while the voice is still being made', () => {
    const html = render({ busy: true });
    expect(html).toContain('生成中');
    expect(html).not.toContain('message-voice-wave');
    expect(html).not.toContain('message-voice-meta');
  });

  it('hides the expand control when there is no transcript to show', () => {
    const html = render({ audioUrl: 'data:audio/mpeg;base64,AA' });
    expect(html).not.toContain('message-voice-expand');
  });

  it('offers a save button only when the bubble can export its audio', () => {
    const withoutHandler = render({ audioUrl: 'data:audio/mpeg;base64,AA' });
    const withHandler = render({ audioUrl: 'data:audio/mpeg;base64,AA', onSaveAudio: () => {} });

    expect(withoutHandler).not.toContain('message-voice-save');
    expect(withHandler).toContain('message-voice-save');
    expect(withHandler).toContain('保存这段语音');
  });
});
