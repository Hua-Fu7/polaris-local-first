import { afterEach, describe, expect, it } from 'vitest';
import type { Persona } from '../../types/domain';
import { buildVoiceMessageToolExecutionContext } from './chatVoiceMessageToolExecutionContext';
import { clearVoiceMessageRequest, readVoiceMessageRequest } from './voiceMessageRequestStore';

const rune = { id: 'collaborator-1', name: 'Rune' } as Persona;

function createContext(ownerCollaboratorId: string | null = rune.id) {
  return buildVoiceMessageToolExecutionContext({
    personas: [rune],
    ownerCollaboratorId,
    conversationId: 'conversation-1'
  });
}

describe('buildVoiceMessageToolExecutionContext', () => {
  afterEach(() => {
    clearVoiceMessageRequest();
  });

  it('turns the tool call into a pending request instead of synthesising audio', () => {
    const result = createContext().sendVoiceMessage('  晚安，我先睡了  ');

    expect(result.ok).toBe(true);
    const request = readVoiceMessageRequest('conversation-1');
    // 只记下「要念的那句话」和时长估算：一分额度都还没花。
    expect(request?.text).toBe('晚安，我先睡了');
    expect(request?.collaboratorName).toBe('Rune');
    expect(request?.durationSeconds).toBeGreaterThan(0);
    expect(request).not.toHaveProperty('assetId');
  });

  it('tells the model the request still needs the user to allow it', () => {
    const result = createContext().sendVoiceMessage('在吗');

    expect(result.ok).toBe(true);
    const detail = result.ok ? result.detailText : '';
    expect(detail).toContain('还没有音频');
    expect(result.ok ? result.summary : '').toContain('已申请');
  });

  it('names the fallback collaborator when the owner is unknown', () => {
    const result = createContext(null).sendVoiceMessage('在吗');

    expect(result.ok).toBe(true);
    expect(readVoiceMessageRequest('conversation-1')?.collaboratorName).toBe('小机');
  });

  it('refuses an empty line instead of asking the user for nothing', () => {
    const result = createContext().sendVoiceMessage('   ');

    expect(result.ok).toBe(false);
    expect(readVoiceMessageRequest('conversation-1')).toBeNull();
  });
});
