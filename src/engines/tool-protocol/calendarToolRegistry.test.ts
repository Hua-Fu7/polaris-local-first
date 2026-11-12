import { describe, expect, it } from 'vitest';
import { resolveAvailablePolarisTools } from './toolRegistry';

describe('calendar note tools', () => {
  it('exposes the four Polaris calendar note tools when the environment tool group is enabled', () => {
    const names = resolveAvailablePolarisTools({
      enabledToolGroups: { environment: true },
      themeToolMode: 'stable'
    }).map((tool) => tool.name);

    expect(names).toEqual(expect.arrayContaining([
      'readCalendarNotes',
      'writeCalendarNote',
      'updateCalendarNote',
      'deleteCalendarNote'
    ]));
  });

  it('stays visible even when every toolbox group is disabled', () => {
    const names = resolveAvailablePolarisTools({
      enabledToolGroups: {
        environment: false,
        task: false,
        room: false,
        project: false,
        desktop: false,
        theme: false,
        attachment: false,
        generation: false,
        archive: false,
        web: false,
        personalData: false,
        mcp: false,
        knowledge: false,
        memory: false,
        memoryRecall: false,
        memoryWrite: false,
        proactive: false,
        voice: false,voiceCall: false
      },
      themeToolMode: 'stable'
    }).map((tool) => tool.name);

    expect(names).toEqual(expect.arrayContaining([
      'readCalendarNotes',
      'writeCalendarNote',
      'updateCalendarNote',
      'deleteCalendarNote'
    ]));
  });
});
