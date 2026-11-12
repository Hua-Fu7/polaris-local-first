import { describe, expect, it } from 'vitest';
import { shouldNotifyReplyCompletion } from './replyCompletionFeedback';

describe('shouldNotifyReplyCompletion', () => {
  it('人在这个对话里、App 也开着：不弹通知（只震一下）', () => {
    expect(shouldNotifyReplyCompletion({ appVisible: true, viewingConversation: true })).toBe(false);
  });

  it('切到别的 App 了：要弹', () => {
    expect(shouldNotifyReplyCompletion({ appVisible: false, viewingConversation: true })).toBe(true);
  });

  it('人在 App 里但看的是别的对话：也要弹', () => {
    expect(shouldNotifyReplyCompletion({ appVisible: true, viewingConversation: false })).toBe(true);
  });

  it('两者都不满足：弹', () => {
    expect(shouldNotifyReplyCompletion({ appVisible: false, viewingConversation: false })).toBe(true);
  });
});
