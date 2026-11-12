import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createVoiceCallInvite, VOICE_CALL_INVITE_TTL_MS } from '../../engines/voiceCallInvite';
import {
  clearVoiceCallInvite,
  getVoiceCallInviteSnapshot,
  publishVoiceCallInvite,
  readVoiceCallInvite,
  resetVoiceCallInviteStore,
  subscribeVoiceCallInvite,
  takeVoiceCallInvite
} from './voiceCallInviteStore';

/*
 * 取用接口读的是真实时钟（`Date.now()`），所以这里的基准时间也必须取真实时间：
 * 写一个固定日期的话，跑在它之后就会全部变成「已过期」。
 */
const NOW = Date.now();

function invite(overrides: { id?: string; now?: number } = {}) {
  return createVoiceCallInvite({
    collaboratorId: 'persona-1',
    collaboratorName: '薇加',
    conversationId: 'conv-1',
    reason: '想跟你说件事',
    now: overrides.now ?? NOW,
    id: overrides.id
  });
}

beforeEach(() => {
  resetVoiceCallInviteStore();
});

describe('voiceCallInviteStore', () => {
  it('starts with nobody calling', () => {
    expect(getVoiceCallInviteSnapshot()).toBeNull();
  });

  it('hands the published invite back to readers', () => {
    const published = publishVoiceCallInvite(invite());

    expect(getVoiceCallInviteSnapshot()).toEqual(published);
    expect(readVoiceCallInvite(NOW)).toEqual(published);
  });

  it('tells subscribers when a call arrives and when it is taken', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeVoiceCallInvite(listener);

    const published = publishVoiceCallInvite(invite());
    expect(listener).toHaveBeenCalledTimes(1);

    takeVoiceCallInvite(published.id);
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    publishVoiceCallInvite(invite());
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('takes the invite away so a connected call cannot ring twice', () => {
    const published = publishVoiceCallInvite(invite());

    expect(takeVoiceCallInvite(published.id)).toEqual(published);
    expect(getVoiceCallInviteSnapshot()).toBeNull();
    expect(takeVoiceCallInvite(published.id)).toBeNull();
  });

  it('refuses to take an invite that has been replaced by a newer one', () => {
    publishVoiceCallInvite(invite({ id: 'call-old' }));
    const fresh = publishVoiceCallInvite(invite({ id: 'call-new' }));

    expect(takeVoiceCallInvite('call-old')).toBeNull();
    expect(getVoiceCallInviteSnapshot()).toEqual(fresh);
  });

  it('clears a refusal and leaves a newer call alone', () => {
    publishVoiceCallInvite(invite({ id: 'call-new' }));
    clearVoiceCallInvite('call-old');
    expect(getVoiceCallInviteSnapshot()?.id).toBe('call-new');

    clearVoiceCallInvite('call-new');
    expect(getVoiceCallInviteSnapshot()).toBeNull();
  });

  /**
   * 一通没人接的电话过期之后不该还在响；读过一次就把它丢掉，
   * 免得界面靠一个已经过期的请求渲染出一屏来电。
   */
  it('drops an invite once it has outlived its ring window', () => {
    publishVoiceCallInvite(invite());

    expect(readVoiceCallInvite(NOW + VOICE_CALL_INVITE_TTL_MS)).toBeNull();
    expect(getVoiceCallInviteSnapshot()).toBeNull();
  });
});
