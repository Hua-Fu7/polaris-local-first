import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { VoiceCallOverlay } from './VoiceCallOverlay';
import type { VoiceCallController } from './useVoiceCall';

/**
 * The call keys are the part of the overlay the user actually touches, so these
 * tests pin the shapes that were asked for by hand: a red receiver with no
 * caption, a mute key that reports its state, and a speaker key that only shows
 * up where the platform can really route audio.
 *
 * The screening phases (ringing / declined / unreachable) are pinned here too:
 * before the other side picks up there is no microphone to mute, so the row has
 * to fall back to the lone receiver.
 */

function controller(overrides: Partial<VoiceCallController> = {}): VoiceCallController {
  return {
    active: true,
    phase: 'listening',
    level: 0,
    heardText: '',
    replyText: '',
    declineLine: null,
    collaboratorName: '薇加',
    error: null,
    playbackReady: true,
    transcriptionReady: true,
    muted: false,
    speakerphone: false,
    speakerphoneSupported: true,
    keyboardOpen: false,
    draft: '',
    start: () => {},
    answerIncoming: () => {},
    end: () => {},
    interrupt: () => {},
    toggleMute: () => {},
    toggleSpeakerphone: () => {},
    openKeyboard: () => {},
    closeKeyboard: () => {},
    setDraft: () => {},
    sendDraft: () => {},
    ...overrides
  };
}

function render(overrides: Partial<VoiceCallController> = {}) {
  return renderToStaticMarkup(<VoiceCallOverlay call={controller(overrides)} />);
}

function buttonTag(html: string, className: string) {
  const match = new RegExp(`<button[^>]*class="[^"]*${className}[^"]*"[^>]*>`).exec(html);
  return match ? match[0] : null;
}

/** The markup between the opening and closing tag of one button. */
function buttonBody(html: string, className: string) {
  const match = new RegExp(
    `<button[^>]*class="[^"]*${className}[^"]*"[^>]*>([\\s\\S]*?)</button>`
  ).exec(html);
  return match ? match[1] : '';
}

describe('VoiceCallOverlay', () => {
  it('hangs up from a red receiver with an icon and no caption', () => {
    const html = render();
    const body = buttonBody(html, 'voice-call-end');

    expect(buttonTag(html, 'voice-call-end')).not.toBeNull();
    // An icon, not a word: the key is only labelled for assistive tech.
    expect(body).toContain('<svg');
    expect(body).not.toMatch(/[\u4e00-\u9fa5]/);
    expect(body).not.toContain('结束通话');
    expect(buttonTag(html, 'voice-call-end')).toContain('aria-label=');
  });

  it('labels the mute key by what tapping it does', () => {
    expect(render({ muted: false })).toContain('静音');
    expect(render({ muted: false })).not.toContain('取消静音');

    const mutedHtml = render({ muted: true });
    expect(mutedHtml).toContain('取消静音');
    // Filled while muted, so the state is visible without reading the caption.
    expect(buttonTag(mutedHtml, 'voice-call-key on')).not.toBeNull();
    expect(buttonTag(mutedHtml, 'voice-call-key on')).toContain('aria-pressed="true"');
    expect(mutedHtml).toContain('已静音');
  });

  it('clears the input meter and the listening hint while muted', () => {
    const html = render({ muted: true, level: 0.9 });
    expect(html).not.toContain('说完停顿一下');
    expect(html).toContain('--voice-call-level:0.000');
  });

  it('only offers the speaker key where audio routing is controllable', () => {
    expect(render({ speakerphoneSupported: true })).toContain('免提');
    expect(render({ speakerphoneSupported: false })).not.toContain('免提');
    expect(render({ speakerphone: true })).toContain('aria-pressed="true"');
    expect(render({ speakerphone: false })).toContain('aria-pressed="false"');
  });

  it('offers the interrupt key only while the assistant is talking', () => {
    expect(render({ phase: 'listening' })).not.toContain('打断');
    expect(render({ phase: 'speaking' })).toContain('打断');
  });

  it('names who is being called while it is ringing', () => {
    const html = render({ phase: 'ringing', collaboratorName: '薇加' });

    expect(html).toContain('正在呼叫 薇加');
    expect(html).toContain('电话在响');
    expect(buttonTag(html, 'voice-call-end')).not.toBeNull();
  });

  it('keeps only the receiver while the call is not connected', () => {
    for (const phase of ['ringing', 'declined', 'unreachable'] as const) {
      const html = render({ phase });
      // No microphone is open yet, so mute and speaker would be dead keys.
      expect(html).not.toContain('静音');
      expect(html).not.toContain('免提');
      // 「改用打字」也一样：还没接通，先用不着选择怎么说。
      expect(html).not.toContain('打字');
      expect(buttonTag(html, 'voice-call-end')).not.toBeNull();
    }
  });

  /*
   * 转写那一步不配文案。
   *
   * 它常只有几百毫秒，一行字刚出现就消失，看起来像界面在抖；而且「正在把你的
   * 话转成文字」只是把机器内部的动作念给用户听 —— 他本来就知道自己刚说了话。
   */
  it('says nothing at all while transcribing', () => {
    const html = render({ phase: 'transcribing' });

    expect(html).not.toContain('正在把你的话转成文字');
    expect(html).not.toContain('聆听中');
    // 那行字的壳还在（整块界面是竖向居中的，少一行会让 orb 跳一下）。
    expect(html).toContain('voice-call-phase');
    expect(buttonBody(html, 'voice-call-phase').trim()).toBe('');
  });

  it('swaps the microphone for a keyboard when you would rather type', () => {
    const closed = render({ keyboardOpen: false });

    expect(closed).toContain('打字');
    expect(closed).not.toContain('voice-call-composer');
    expect(closed).not.toContain('keyboard-open');

    const open = render({ keyboardOpen: true, draft: '在吗' });

    expect(open).toContain('voice-call-composer');
    expect(open).toContain('value="在吗"');
    // 打开键盘时 orb 让位给软键盘。
    expect(open).not.toContain('voice-call-orb');
    expect(open).toContain('keyboard-open');
    // 打字键亮起来，跟静音键的「开着」是同一套视觉语言。
    expect(buttonTag(open, 'voice-call-key on')).not.toBeNull();
    expect(buttonTag(open, 'voice-call-key on')).toContain('aria-pressed="true"');
  });

  it('disables send until something has been typed', () => {
    expect(render({ keyboardOpen: true, draft: '   ' })).toContain('disabled');
    expect(render({ keyboardOpen: true, draft: '在吗' })).not.toContain('disabled');
  });

  it('drops the listening hint while the keyboard is up', () => {
    // 麦克风关着的时候说「说完停顿一下」是句假话。
    expect(render({ phase: 'listening', keyboardOpen: true })).not.toContain('说完停顿一下');
    expect(render({ phase: 'listening', keyboardOpen: false })).toContain('说完停顿一下');
  });

  it('falls back to a neutral name when there is nobody to name', () => {
    expect(render({ phase: 'ringing', collaboratorName: '' })).toContain('正在呼叫 对方');
  });

  it('announces the refusal by name and repeats their own line verbatim', () => {
    const html = render({ phase: 'declined', declineLine: '在忙，晚点打给你', collaboratorName: '薇加' });

    // The refusal is stated as a fact about them, in the status line...
    expect(html).toContain('薇加拒绝了你的通话');
    // ...while the card carries the assistant speaking through text, so the
    // refusal never reads as a system error.
    expect(html).toContain('在忙，晚点打给你');
    expect(html).not.toContain('voice-call-error');
  });

  it('still names who refused when no line came with it', () => {
    const html = render({ phase: 'declined', declineLine: null });

    expect(html).toContain('薇加拒绝了你的通话');
    // Nothing to quote, so the speech card stays out of the way entirely.
    expect(html).not.toContain('voice-call-said');
  });

  it('reads an unconnected call as an error, not as an answer', () => {
    const html = render({ phase: 'unreachable' });

    expect(html).toContain('无法接通');
    expect(html).toContain('重拨');
    // Nothing was said to us: no speech card here either.
    expect(html).not.toContain('voice-call-said');
  });
});
