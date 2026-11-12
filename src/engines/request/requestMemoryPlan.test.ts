import { describe, expect, it } from 'vitest';
import { resolveRequestMemoryPlan } from './requestMemoryPlan';
import type { PersonaMemorySettings } from '../../types/domain';

function createMemory(overrides: Partial<PersonaMemorySettings> = {}): PersonaMemorySettings {
  return {
    inheritGlobal: true,
    crossConversationRecallEnabled: true,
    excludeFromGlobal: false,
    excludedGlobalIds: [],
    personalMemories: [],
    conversationSummaries: [],
    referenceDocs: [],
    ...overrides
  };
}

describe('resolveRequestMemoryPlan', () => {
  it('inherits memories saved by other collaborators when global memory is enabled', () => {
    const plan = resolveRequestMemoryPlan({
      memory: createMemory({
        personalMemories: ['用户 喜欢清楚边界。']
      }),
      inheritedMemorySources: [
        {
          id: 'nova',
          memory: createMemory({
            personalMemories: ['用户 偏好柔和但明确的解释。']
          })
        }
      ],
      maxTokens: null
    });

    expect(plan.selectedLines).toContain('用户 喜欢清楚边界。');
    expect(plan.selectedLines).toContain('用户 偏好柔和但明确的解释。');
  });

  it('respects disabled global inheritance and excluded collaborators', () => {
    const withoutGlobal = resolveRequestMemoryPlan({
      memory: createMemory({
        inheritGlobal: false,
        personalMemories: ['只读当前协作者。']
      }),
      inheritedMemorySources: [
        {
          id: 'nova',
          memory: createMemory({
            personalMemories: ['不应该被继承。']
          })
        }
      ],
      maxTokens: null
    });

    expect(withoutGlobal.selectedLines).toEqual(['只读当前协作者。']);

    const withExcludedSource = resolveRequestMemoryPlan({
      memory: createMemory({
        excludedGlobalIds: ['nova'],
        personalMemories: ['当前协作者记忆。']
      }),
      inheritedMemorySources: [
        {
          id: 'nova',
          memory: createMemory({
            personalMemories: ['被排除的协作者记忆。']
          })
        },
        {
          id: 'mimo',
          memory: createMemory({
            personalMemories: ['未排除的协作者记忆。']
          })
        }
      ],
      maxTokens: null
    });

    expect(withExcludedSource.selectedLines).toContain('当前协作者记忆。');
    expect(withExcludedSource.selectedLines).toContain('未排除的协作者记忆。');
    expect(withExcludedSource.selectedLines).not.toContain('被排除的协作者记忆。');
  });

  it('does not inherit memories from collaborators excluded from global memory', () => {
    const plan = resolveRequestMemoryPlan({
      memory: createMemory({
        personalMemories: ['当前协作者记忆。']
      }),
      inheritedMemorySources: [
        {
          id: 'private',
          memory: createMemory({
            excludeFromGlobal: true,
            personalMemories: ['不进入全局的协作者记忆。']
          })
        },
        {
          id: 'shared',
          memory: createMemory({
            personalMemories: ['允许进入全局的协作者记忆。']
          })
        }
      ],
      maxTokens: null
    });

    expect(plan.selectedLines).toContain('当前协作者记忆。');
    expect(plan.selectedLines).toContain('允许进入全局的协作者记忆。');
    expect(plan.selectedLines).not.toContain('不进入全局的协作者记忆。');
  });
  it('常驻几条 + 只带跟这句话相关的记忆', async () => {
    const { resolveRequestMemoryPlan } = await import('./requestMemoryPlan');
    const plan = resolveRequestMemoryPlan({
      memory: {
        ...createMemory(),
        personalMemories: [
          'Rune 的名字是先取的，很重要。',
          'Rune 的生日是 3 月 14 日。',
          'Rune 讨厌香菜。',
          'Rune 在做一个叫 Solune 的软件项目。',
          'Rune 养了一只猫叫年糕。'
        ]
      },
      maxTokens: null,
      focusText: '我生日快到了要准备什么',
      coreLineLimit: 2
    });

    const kept = plan.entries.filter((entry) => entry.status === 'kept').map((entry) => entry.text);
    const dropped = plan.entries.filter((entry) => entry.status === 'dropped_irrelevant').map((entry) => entry.text);

    expect(kept.length).toBeGreaterThanOrEqual(2);              // 常驻 2 条 + 相关
    expect(kept).toContain('Rune 的生日是 3 月 14 日。');       // 相关，必须带上
    expect(dropped).toContain('Rune 养了一只猫叫年糕。');       // 不相关，跳过
  });

  it('常驻与按需分开返回：常驻留在系统提示，按需挪到用户消息前', async () => {
    const { resolveRequestMemoryPlan } = await import('./requestMemoryPlan');
    const plan = resolveRequestMemoryPlan({
      memory: {
        ...createMemory(),
        personalMemories: [
          'Rune 的生日是 3 月 14 日。',
          'Rune 讨厌香菜。',
          'Rune 养了一只猫叫年糕。'
        ]
      },
      maxTokens: null,
      focusText: '年糕今天不吃东西',
      coreLineLimit: 1
    });

    expect(plan.coreLines).toEqual(['Rune 的生日是 3 月 14 日。']);
    expect(plan.relevantLines).toContain('Rune 养了一只猫叫年糕。');
    // 常驻不能再出现在按需里，否则会被发两遍
    expect(plan.relevantLines).not.toContain('Rune 的生日是 3 月 14 日。');
  });

  it('没有 focusText 时只带常驻，不再退回"全部带上"', async () => {
    const { resolveRequestMemoryPlan } = await import('./requestMemoryPlan');
    const plan = resolveRequestMemoryPlan({
      memory: { ...createMemory(), personalMemories: ['A 记忆', 'B 记忆', 'C 记忆', 'D 记忆'] },
      maxTokens: null,
      coreLineLimit: 2
    });

    const kept = plan.entries.filter((entry) => entry.status === 'kept');
    const dropped = plan.entries.filter((entry) => entry.status === 'dropped_irrelevant');
    expect(kept.length).toBe(2);
    expect(dropped.length).toBe(2);
  });
  it('默认常驻优先挑带「名字/生日」的，不够再按权重补', async () => {
    const { resolveRequestMemoryPlan } = await import('./requestMemoryPlan');
    const plan = resolveRequestMemoryPlan({
      memory: {
        ...createMemory(),
        personalMemories: ['他讨厌香菜。', '他养了一只猫。', '他的生日是 3 月 14 日。']
      },
      maxTokens: null,
      focusText: '今天天气不错',
      coreLineLimit: 1
    });

    const kept = plan.entries.filter((entry) => entry.status === 'kept').map((entry) => entry.text);
    expect(kept).toEqual(['他的生日是 3 月 14 日。']);
  });

  it('用户手动勾了常驻就听用户的', async () => {
    const { resolveRequestMemoryPlan } = await import('./requestMemoryPlan');
    const plan = resolveRequestMemoryPlan({
      memory: {
        ...createMemory(),
        personalMemories: ['他讨厌香菜。', '他的生日是 3 月 14 日。'],
        coreMemories: ['他讨厌香菜。']
      },
      maxTokens: null,
      focusText: '今天天气不错',
      coreLineLimit: 3
    });

    const kept = plan.entries.filter((entry) => entry.status === 'kept').map((entry) => entry.text);
    expect(kept).toEqual(['他讨厌香菜。']);
  });
  it('解析不出身份的记忆永远不参与匹配（空身份不能互相相等）', async () => {
    const { memoryIdentity, resolveRequestMemoryPlan } = await import('./requestMemoryPlan');

    expect(memoryIdentity('   ')).toBe('');
    expect(memoryIdentity('')).toBe('');

    const plan = resolveRequestMemoryPlan({
      memory: {
        ...createMemory(),
        personalMemories: ['   ', '', '他的名字是先取的。'],
        coreMemories: ['   ']
      },
      maxTokens: null,
      focusText: '随便聊聊',
      coreLineLimit: 3
    });

    const kept = plan.entries.filter((entry) => entry.status === 'kept').map((entry) => entry.text);
    // 空白那条既没被当成"常驻命中"，也没被当成匹配到别的记忆
    expect(kept).not.toContain('   ');
    expect(plan.selectedLines.every((line) => line.trim().length > 0)).toBe(true);
  });
});
