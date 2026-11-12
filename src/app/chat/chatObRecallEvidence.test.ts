import { describe, expect, it } from 'vitest';
import { buildChatObRecallEvidence } from './chatObRecallEvidence';
import type { ObRecallResult } from '../../engines/ombreBrain/obRecall';

function result(overrides: Partial<ObRecallResult> = {}): ObRecallResult {
  return { attempted: true, hits: [], lines: [], error: null, ...overrides };
}

describe('buildChatObRecallEvidence', () => {
  it('没真的去搜就不挂任何东西', () => {
    expect(buildChatObRecallEvidence(null)).toBeUndefined();
    expect(buildChatObRecallEvidence(result({ attempted: false }))).toBeUndefined();
  });

  it('搜到几条就记几条，内容截取预览', () => {
    const evidence = buildChatObRecallEvidence(result({
      hits: [{
        id: 'b1',
        name: '生日',
        score: 0.42,
        domain: [],
        contentPreview: '3 月 14 日'
      }],
      lines: ['生日：3 月 14 日']
    }));

    expect(evidence).toMatchObject({
      status: 'ok',
      count: 1,
      items: [{ id: 'b1', name: '生日', excerpt: '3 月 14 日', score: 0.42 }]
    });
    expect(evidence?.error).toBeUndefined();
  });

  it('搜失败也留一条记录，并带上原因', () => {
    const evidence = buildChatObRecallEvidence(result({ error: 'OB 请求超时' }));

    expect(evidence).toMatchObject({
      status: 'failed',
      count: 0,
      error: 'OB 请求超时'
    });
  });
});
