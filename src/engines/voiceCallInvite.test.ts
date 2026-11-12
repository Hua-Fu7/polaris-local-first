import { describe, expect, it } from 'vitest';
import {
  createVoiceCallInvite,
  describeVoiceCallInvite,
  isVoiceCallInviteExpired,
  normalizeVoiceCallReason,
  VOICE_CALL_INVITE_MAX_REASON_CHARS,
  VOICE_CALL_INVITE_TTL_MS
} from './voiceCallInvite';

const NOW = new Date(2026, 8, 19, 18, 30).getTime();

describe('normalizeVoiceCallReason', () => {
  it('collapses whitespace so the line stays one line on screen', () => {
    expect(normalizeVoiceCallReason('  想跟你说   件事 \n')).toBe('想跟你说 件事');
  });

  it('caps the reason at the screen budget', () => {
    expect(normalizeVoiceCallReason('啊'.repeat(200)))
      .toHaveLength(VOICE_CALL_INVITE_MAX_REASON_CHARS);
  });

  it('treats a missing reason as no reason at all', () => {
    expect(normalizeVoiceCallReason(undefined)).toBe('');
    expect(normalizeVoiceCallReason(null)).toBe('');
    expect(normalizeVoiceCallReason('   ')).toBe('');
  });
});

describe('createVoiceCallInvite', () => {
  it('carries who is calling, where, and why', () => {
    const invite = createVoiceCallInvite({
      collaboratorId: 'persona-1',
      collaboratorName: '薇加',
      conversationId: 'conv-1',
      reason: '想跟你说件事',
      now: NOW
    });

    expect(invite).toMatchObject({
      collaboratorId: 'persona-1',
      collaboratorName: '薇加',
      conversationId: 'conv-1',
      reason: '想跟你说件事',
      createdAt: NOW,
      expiresAt: NOW + VOICE_CALL_INVITE_TTL_MS
    });
  });

  it('gives every invite its own id even inside the same millisecond', () => {
    const first = createVoiceCallInvite({
      collaboratorId: 'persona-1',
      conversationId: 'conv-1',
      now: NOW
    });
    const second = createVoiceCallInvite({
      collaboratorId: 'persona-1',
      conversationId: 'conv-1',
      now: NOW
    });

    expect(first.id).not.toBe(second.id);
  });

  it('keeps an id handed in from outside, so a notification tap cannot double-ring', () => {
    const invite = createVoiceCallInvite({
      collaboratorId: 'persona-1',
      conversationId: 'conv-1',
      id: 'voice-call-tap-42',
      now: NOW
    });

    expect(invite.id).toBe('voice-call-tap-42');
  });
});

describe('isVoiceCallInviteExpired', () => {
  it('expires exactly at the deadline, not a tick later', () => {
    const invite = createVoiceCallInvite({
      collaboratorId: 'persona-1',
      conversationId: 'conv-1',
      now: NOW
    });

    expect(isVoiceCallInviteExpired(invite, NOW + VOICE_CALL_INVITE_TTL_MS - 1)).toBe(false);
    expect(isVoiceCallInviteExpired(invite, NOW + VOICE_CALL_INVITE_TTL_MS)).toBe(true);
  });
});

describe('describeVoiceCallInvite', () => {
  it('uses the collaborator name when there is one', () => {
    const invite = createVoiceCallInvite({
      collaboratorId: 'persona-1',
      collaboratorName: '薇加',
      conversationId: 'conv-1',
      reason: '在忙吗',
      now: NOW
    });

    expect(describeVoiceCallInvite(invite, '对方')).toEqual({ name: '薇加', reason: '在忙吗' });
  });

  it('hands the placeholder back when the name is unknown, rather than inventing one', () => {
    const invite = createVoiceCallInvite({
      collaboratorId: 'persona-1',
      conversationId: 'conv-1',
      now: NOW
    });

    expect(describeVoiceCallInvite(invite, '对方').name).toBe('对方');
  });
});
