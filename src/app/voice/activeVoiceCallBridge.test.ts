import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  readActiveVoiceCall,
  registerActiveVoiceCall,
  requestActiveVoiceCallHangUp,
  resetActiveVoiceCallBridge,
  unregisterActiveVoiceCall
} from './activeVoiceCallBridge';

afterEach(() => {
  resetActiveVoiceCallBridge();
});

describe('activeVoiceCallBridge', () => {
  it('starts empty', () => {
    expect(readActiveVoiceCall()).toBeNull();
    expect(requestActiveVoiceCallHangUp()).toBe(false);
  });

  it('registers a call and lets the tool hang it up', () => {
    const hangUp = vi.fn();
    registerActiveVoiceCall({
      conversationId: 'conv-1',
      collaboratorId: 'persona-1',
      collaboratorName: '薇加',
      hangUp
    });

    expect(readActiveVoiceCall()).toMatchObject({
      conversationId: 'conv-1',
      collaboratorId: 'persona-1',
      collaboratorName: '薇加'
    });

    expect(requestActiveVoiceCallHangUp()).toBe(true);
    expect(hangUp).toHaveBeenCalledTimes(1);
  });

  it('unregisters on call end', () => {
    registerActiveVoiceCall({
      conversationId: 'conv-1',
      collaboratorId: 'persona-1',
      collaboratorName: '薇加',
      hangUp: vi.fn()
    });

    unregisterActiveVoiceCall();

    expect(readActiveVoiceCall()).toBeNull();
    expect(requestActiveVoiceCallHangUp()).toBe(false);
  });
});
