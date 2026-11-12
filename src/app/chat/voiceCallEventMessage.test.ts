import { describe, expect, it } from 'vitest';
import { createTranslator } from '../../i18n';
import {
  createVoiceCallConnectedNoteMessage,
  createVoiceCallDeclinedWakeMessage,
  createVoiceCallEndedWakeMessage,
  createVoiceCallMissedWakeMessage,
  createVoiceCallNoteMessage,
  formatVoiceCallDuration
} from './voiceCallEventMessage';

const zh = createTranslator('zh-CN').t;
const en = createTranslator('en-US').t;

describe('formatVoiceCallDuration', () => {
  it('writes a telephone-style m:ss', () => {
    expect(formatVoiceCallDuration(0)).toBe('0:00');
    expect(formatVoiceCallDuration(9_000)).toBe('0:09');
    expect(formatVoiceCallDuration(65_000)).toBe('1:05');
    expect(formatVoiceCallDuration(133_400)).toBe('2:13');
  });

  it('never goes negative when the clock is odd', () => {
    expect(formatVoiceCallDuration(-5_000)).toBe('0:00');
  });
});

describe('createVoiceCallNoteMessage', () => {
  it('records a refusal the user can actually see, in the timeline', () => {
    const message = createVoiceCallNoteMessage({
      event: { kind: 'declined', declineLine: '在忙，晚点打给你' },
      collaboratorName: '薇加',
      t: zh
    });

    // system-note renders as the inline note in the timeline; trigger-runtime
    // messages are skipped there, so they would be invisible.
    expect(message.role).toBe('system');
    expect(message.origin).toBe('system-note');
    expect(message.content).toBe('你给薇加打了个电话，被拒绝了。TA 说：「在忙，晚点打给你」');
  });

  it('drops the quotation when the refusal came without a line', () => {
    const message = createVoiceCallNoteMessage({
      event: { kind: 'declined', declineLine: '   ' },
      collaboratorName: '薇加',
      t: zh
    });

    expect(message.content).toBe('你给薇加打了个电话，被拒绝了。');
    expect(message.content).not.toContain('TA 说');
  });

  it('tells the model what happened in the second person, without asking for a reply', () => {
    const message = createVoiceCallNoteMessage({
      event: { kind: 'declined', declineLine: '在忙，晚点打给你' },
      collaboratorName: '薇加',
      t: zh
    });

    expect(message.requestContent).toContain('你选择了不接');
    expect(message.requestContent).toContain('在忙，晚点打给你');
    // No requestRole means the note stays a system message in the request too:
    // it is context, not a turn the model owes an answer to.
    expect(message.requestRole).toBeUndefined();
    // DeepSeek 一类会把易变 system 层整组丢掉；通话记录带送达保证，不允许被丢。
    expect(message.requestDelivery).toBe('always');
  });

  it('records a connected call with its duration', () => {
    const message = createVoiceCallNoteMessage({
      event: { kind: 'connected', durationMs: 133_400 },
      collaboratorName: '薇加',
      t: zh
    });

    expect(message.content).toBe('你和薇加通话了 2:13。');
    expect(message.origin).toBe('system-note');
    expect(message.requestContent).toContain('2:13');
    expect(message.requestDelivery).toBe('always');
  });

  it('records the other direction: they called and the user did not pick up', () => {
    const message = createVoiceCallNoteMessage({
      event: { kind: 'missed' },
      collaboratorName: '薇加',
      t: zh
    });

    expect(message.origin).toBe('system-note');
    expect(message.content).toBe('薇加给你打了个电话，你没接。');
    // 这条记录也是给模型看的事实：它得知道自己那通电话没被接起来。
    expect(message.requestContent).toContain('你主动给用户打了一通语音电话');
    expect(message.requestRole).toBeUndefined();
  });

  it('falls back to a neutral name when nobody can be named', () => {
    const message = createVoiceCallNoteMessage({
      event: { kind: 'declined', declineLine: null },
      collaboratorName: '  ',
      t: zh
    });

    expect(message.content).toBe('你给对方打了个电话，被拒绝了。');
  });

  it('localises the record for English speakers', () => {
    const declined = createVoiceCallNoteMessage({
      event: { kind: 'declined', declineLine: 'Busy right now' },
      collaboratorName: 'Vega',
      t: en
    });
    const connected = createVoiceCallNoteMessage({
      event: { kind: 'connected', durationMs: 65_000 },
      collaboratorName: 'Vega',
      t: en
    });
    const missed = createVoiceCallNoteMessage({
      event: { kind: 'missed' },
      collaboratorName: 'Vega',
      t: en
    });

    expect(declined.content).toBe('You called Vega — they declined. They said: "Busy right now"');
    expect(connected.content).toBe('You and Vega were on a call for 1:05.');
    expect(missed.content).toBe('Vega called you — you did not pick up.');
  });
});

describe('createVoiceCallConnectedNoteMessage', () => {
  it('tells the model it is on a call now, not that the call ended', () => {
    const message = createVoiceCallConnectedNoteMessage({
      collaboratorName: '薇加',
      t: zh
    });

    expect(message.origin).toBe('system-note');
    expect(message.content).toBe('你和薇加正在通话。');
    // 关键：这条是「正在通话中」，不是「通话了 0:00」。模型据此知道自己在说话。
    expect(message.requestContent).toContain('正在通话');
    expect(message.requestContent).not.toContain('时长');
    expect(message.requestRole).toBeUndefined();
    expect(message.requestDelivery).toBe('always');
  });

  it('falls back to a neutral name when nobody can be named', () => {
    const message = createVoiceCallConnectedNoteMessage({
      collaboratorName: '  ',
      t: zh
    });

    expect(message.content).toBe('你和对方正在通话。');
  });

  it('marks an inbound call with the reason the model chose to answer', () => {
    const message = createVoiceCallConnectedNoteMessage({
      collaboratorName: '薇加',
      acceptedReason: '正好有空，接',
      t: zh
    });

    // 时间线文案不变；给模型看的那面要带上「拨入 + 判断接听 + 理由」，
    // 否则模型在通话中不知道自己刚判断过、也不知道是用户打过来的。
    expect(message.content).toBe('你和薇加正在通话。');
    expect(message.requestContent).toContain('拨入');
    expect(message.requestContent).toContain('判断要接听');
    expect(message.requestContent).toContain('正好有空，接');
    expect(message.requestDelivery).toBe('always');
  });

  it('stays direction-neutral when there is no accepted reason', () => {
    const message = createVoiceCallConnectedNoteMessage({
      collaboratorName: '薇加',
      t: zh
    });

    expect(message.requestContent).toContain('正在通话');
    expect(message.requestContent).not.toContain('拨入');
  });
});

describe('createVoiceCallDeclinedWakeMessage', () => {
  it('is a trigger-runtime turn that asks the model to reply now', () => {
    const message = createVoiceCallDeclinedWakeMessage({ t: zh });

    // trigger-runtime 在时间线被跳过，只作为一轮输入喂给模型。
    expect(message.origin).toBe('trigger-runtime');
    // 关键区别：requestRole 是 user，模型会把它当成一轮输入、当场回应；
    // 而不是 system-note 那样 requestRole 留空、只当背景事实。
    expect(message.requestRole).toBe('user');
    expect(message.requestContent).toContain('被用户拒接');
    expect(message.requestContent).toContain('回应');
  });

  it('localises for English speakers', () => {
    const message = createVoiceCallDeclinedWakeMessage({ t: en });
    expect(message.requestContent).toContain('declined by the user');
  });
});

describe('createVoiceCallMissedWakeMessage', () => {
  it('wakes the model after a call went unanswered and auto-hung-up', () => {
    const message = createVoiceCallMissedWakeMessage({ t: zh });

    expect(message.origin).toBe('trigger-runtime');
    expect(message.requestRole).toBe('user');
    expect(message.requestContent).toContain('一直没有接');
    expect(message.requestContent).toContain('自动挂断');
  });
});

describe('createVoiceCallEndedWakeMessage', () => {
  it('wakes the model after a call ends normally', () => {
    const message = createVoiceCallEndedWakeMessage({ t: zh });

    expect(message.origin).toBe('trigger-runtime');
    expect(message.requestRole).toBe('user');
    expect(message.requestContent).toContain('刚刚结束');
    expect(message.requestContent).toContain('回应');
  });
});
