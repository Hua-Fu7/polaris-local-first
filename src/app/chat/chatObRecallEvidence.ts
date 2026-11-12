import type { ChatObRecallEvidence } from '../../types/domain';
import type { ObRecallResult } from '../../engines/ombreBrain/obRecall';

/**
 * 把一轮召回结果变成挂在消息上的显示数据。
 *
 * 没真的去搜（开关关着、没密码、这句没正文）就返回 undefined —— 不显示任何东西，
 * 否则每条消息旁边都挂个“召回 0 条”，等于噪音。
 */
export function buildChatObRecallEvidence(
  recall: ObRecallResult | null | undefined
): ChatObRecallEvidence | undefined {
  if (!recall?.attempted) return undefined;
  return {
    status: recall.error ? 'failed' : 'ok',
    count: recall.hits.length,
    error: recall.error ?? undefined,
    items: recall.hits.map((hit) => ({
      id: hit.id,
      name: hit.name,
      excerpt: hit.contentPreview,
      score: hit.score
    }))
  };
}
