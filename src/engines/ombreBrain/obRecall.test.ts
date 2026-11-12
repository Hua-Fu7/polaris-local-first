import { describe, expect, it } from 'vitest';
import { buildObRecallLines, isTrivialRecallQuery, resolveObRecall } from './obRecall';
import type { ObClient, ObSearchHit } from './obClient';
import type { ObBrainSettings } from '../../types/domain';

function hit(overrides: Partial<ObSearchHit> & { id: string }): ObSearchHit {
  return {
    name: overrides.name ?? overrides.id,
    score: 1,
    domain: [],
    contentPreview: '内容',
    ...overrides
  };
}

function settings(overrides: Partial<ObBrainSettings> = {}): ObBrainSettings {
  return { enabled: true, baseUrl: 'https://ob.example', timeoutMs: 800, ...overrides };
}

describe('isTrivialRecallQuery', () => {
  it('招呼、应答、笑声不值得搜', () => {
    for (const text of ['哈哈哈', '哈哈哈哈哈哈', '哦', '好', '好的', '嗯嗯', '谢谢', '收到', 'ok', '拜拜', '你好', '哈哈哈。']) {
      expect(isTrivialRecallQuery(text), text).toBe(true);
    }
  });

  it('纯表情和纯标点也不搜', () => {
    expect(isTrivialRecallQuery('😂😂')).toBe(true);
    expect(isTrivialRecallQuery('？？？')).toBe(true);
    expect(isTrivialRecallQuery('   ')).toBe(true);
  });

  it('有信息量的短词必须照搜', () => {
    for (const text of ['生日', '猫', '我爸', '加班', '香菜', 'Polaris', '3 月 14 日']) {
      expect(isTrivialRecallQuery(text), text).toBe(false);
    }
  });

  it('带语气词的正常句子不能被误伤', () => {
    expect(isTrivialRecallQuery('我今天好累啊')).toBe(false);
    expect(isTrivialRecallQuery('好吧那生日是什么时候')).toBe(false);
  });
});

describe('buildObRecallLines', () => {
  it('按 id 去重，空内容丢掉', () => {
    const lines = buildObRecallLines([
      hit({ id: 'b1', name: '生日', contentPreview: '3 月 14 日' }),
      hit({ id: 'b1', name: '生日', contentPreview: '重复的那条' }),
      hit({ id: 'b2', contentPreview: '   ' })
    ]);

    expect(lines).toEqual(['生日：3 月 14 日']);
  });

  it('有名字时加前缀，正文已经带名字就不重复加', () => {
    const lines = buildObRecallLines([
      hit({ id: 'b1', name: '生日', contentPreview: '生日是 3 月 14 日' })
    ]);

    expect(lines).toEqual(['生日是 3 月 14 日']);
  });

  it('最多给几条', () => {
    const hits = Array.from({ length: 8 }, (_, index) => hit({ id: `b${index}`, contentPreview: `第 ${index} 条` }));

    expect(buildObRecallLines(hits, 3)).toHaveLength(3);
  });
});

describe('resolveObRecall', () => {
  function fakeClient(hits: ObSearchHit[], error: string | null = null) {
    const calls: Array<{ query: string; budgetMs?: number }> = [];
    const client: ObClient = {
      search: async (query, options) => {
        calls.push({ query, budgetMs: options?.budgetMs });
        return hits;
      },
      listBuckets: async () => [],
      fetchBucket: async () => null,
      getLastError: () => error,
      reset: () => undefined
    };
    return { client, calls };
  }

  it('开关关着就不发请求', async () => {
    const { client, calls } = fakeClient([hit({ id: 'b1' })]);
    const result = await resolveObRecall({
      settings: settings({ enabled: false }),
      focusText: '猫',
      client
    });

    expect(result.lines).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('地址没填就不发请求', async () => {
    const { client, calls } = fakeClient([]);
    await resolveObRecall({ settings: settings({ baseUrl: '  ' }), focusText: '猫', client });

    expect(calls).toHaveLength(0);
  });

  it('这一轮没有正文就不发请求', async () => {
    const { client, calls } = fakeClient([]);
    await resolveObRecall({ settings: settings(), focusText: '   ', client });

    expect(calls).toHaveLength(0);
  });

  it('拿不到密码就跳过，不报错', async () => {
    // 不注入 client：走真实分支，空密码必须在建连接之前就退出。
    const result = await resolveObRecall({
      settings: settings(),
      focusText: '猫',
      loadPassword: async () => ''
    });

    expect(result.lines).toEqual([]);
    expect(result.error).toBeNull();
  });

  it('命中时把内容拼成行，并带上 800ms 预算', async () => {
    const { client, calls } = fakeClient([
      hit({ id: 'b1', name: '猫', contentPreview: '养了一只猫，叫团子' })
    ]);

    const result = await resolveObRecall({ settings: settings(), focusText: '我的猫', client });

    expect(calls).toEqual([{ query: '我的猫', budgetMs: 800 }]);
    expect(result.lines).toEqual(['猫：养了一只猫，叫团子']);
    expect(result.hits).toHaveLength(1);
  });

  it('预算跟设置里那一项走，方便装机后实测再调', async () => {
    const { client, calls } = fakeClient([]);

    await resolveObRecall({ settings: settings({ timeoutMs: 2500 }), focusText: '猫', client });

    expect(calls).toEqual([{ query: '猫', budgetMs: 2500 }]);
  });

  it('请求失败时静默返回空，原因带出来给设置页', async () => {
    const { client } = fakeClient([], 'OB 请求超时');

    const result = await resolveObRecall({ settings: settings(), focusText: '猫', client });

    expect(result.lines).toEqual([]);
    expect(result.error).toBe('OB 请求超时');
  });
});
