// OB 自动召回（B 层）。
//
// 一条消息发出前去 OB 搜一次，把命中的内容拼成几行，塞进「本轮请求上下文」，
// 位置在**最新一条用户消息之前**——这样不会动到前缀缓存。
//
// 三条硬规矩：
//   - 只有开关打开、地址填了、密码拿得到、这句有正文，才真的发请求
//   - 预算 800ms，比整轮回复短得多；到点就当作没搜到
//   - 失败一律静默，只在内部留 error 给设置页看，不影响聊天

import type { ObBrainSettings } from '../../types/domain';
import { createObClient, type ObClient, type ObSearchHit } from '../ombreBrain/obClient';

/** 召回预算的默认值：实测 800ms 经常不够（设置页用 5 秒测能过，聊天用 0.8 秒就失败）。 */
export const OB_RECALL_DEFAULT_BUDGET_MS = 2000;
export const OB_RECALL_MAX_HITS = 3;

export type ObRecallResult = {
  /** 这一轮到底有没有真的去搜。没开/没密码/没正文都是 false，界面据此决定显示不显示。 */
  attempted: boolean;
  hits: ObSearchHit[];
  /** 已经拼好的上下文行；空数组表示这一轮没有可带的内容。 */
  lines: string[];
  error: string | null;
};

/** 这些整句就是招呼/应答，搜了也是白搜。 */
const TRIVIAL_QUERIES = new Set([
  'ok', 'okay', 'okk', 'okkk',
  '你好', '您好', '在吗', '在么',
  '好的', '好吧', '行', '行吧', '可以', '收到', '知道了', '明白',
  '谢谢', '多谢', '谢了', '拜拜', '再见', '晚安', '早安',
  '哈哈哈', '哈哈哈哈', '呵呵', '嘿嘿', '嘻嘻', '嗨', '哈喽'
]);

/** 语气词/应答字：整句只由这些字组成、且很短，就当成"没内容"。 */
const FILLER_CHARS = new Set(Array.from('哈呵嘿嘻嗯哦噢喔好行可以是对收到谢拜晚早啦吧呢啊呀哟哇嗨么嘛咯咧'));

const PUNCTUATION = /[\s!-/:-@[-`{-~。，、！？；：“”‘’（）()【】《》〈〉「」『』…—～·]/g;
const MEANINGFUL_CHAR = /[a-zA-Z0-9\u4e00-\u9fff]/;

/**
 * 这句话值不值得去 OB 搜。
 *
 * 「哈哈哈」「哦」「好的」这类搜了只会带回一堆不相干的东西，还平白多一次请求；
 * 但别过度跳过——「生日」「猫」这种短词是有信息量的，必须照搜。
 */
export function isTrivialRecallQuery(text: string): boolean {
  const stripped = text.toLowerCase().replace(PUNCTUATION, '');
  if (!stripped) return true;
  // 纯表情 / 纯符号
  if (!MEANINGFUL_CHAR.test(stripped)) return true;
  if (TRIVIAL_QUERIES.has(stripped)) return true;
  const chars = Array.from(stripped);
  if (chars.length > 4 && new Set(chars).size > 2) return false;
  return chars.every((char) => FILLER_CHARS.has(char));
}

const EMPTY: ObRecallResult = { attempted: false, hits: [], lines: [], error: null };

/**
 * 把命中结果拼成上下文行。
 *
 * 按 id 去重（OB 自己也可能给重复），空内容丢掉，最多 `maxLines` 行。
 * 名字和正文重复时只留正文，别为了加个前缀把 token 拉长。
 */
export function buildObRecallLines(hits: ObSearchHit[], maxLines = OB_RECALL_MAX_HITS): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const hit of hits) {
    const id = hit.id.trim();
    const text = hit.contentPreview.trim();
    if (!id || !text || seen.has(id)) continue;
    seen.add(id);
    const name = hit.name.trim();
    lines.push(name && name !== id && !text.startsWith(name) ? `${name}：${text}` : text);
    if (lines.length >= Math.max(0, maxLines)) break;
  }
  return lines;
}

export async function resolveObRecall(args: {
  settings?: ObBrainSettings;
  /** 用户这一轮说的话（没有正文时传空串）。 */
  focusText: string;
  loadPassword?: () => Promise<string>;
  /** 测试注入用；外部不传就按设置现建一个。 */
  client?: ObClient;
}): Promise<ObRecallResult> {
  const settings = args.settings;
  const query = args.focusText.trim();
  if (!settings?.enabled || !settings.baseUrl.trim() || !query) return EMPTY;
  // 「哈哈哈」「哦」「好的」这种不值得搜：省一次请求，也省一次误命中。
  if (isTrivialRecallQuery(query)) return EMPTY;

  let client = args.client;
  if (!client) {
    const password = (await args.loadPassword?.())?.trim() ?? '';
    // 密码还没配好就安静跳过：设置页会提示"还没填密码"，聊天不该因此报错。
    if (!password) return EMPTY;
    client = createObClient({
      baseUrl: settings.baseUrl,
      password,
      timeoutMs: settings.timeoutMs
    });
  }

  // 预算是设置里那一项：装机实测后觉得经常超时，直接把「超时（毫秒）」调大就行。
  const budgetMs = settings.timeoutMs > 0 ? settings.timeoutMs : OB_RECALL_DEFAULT_BUDGET_MS;
  const hits = await client.search(query, {
    budgetMs,
    limit: OB_RECALL_MAX_HITS
  });
  return {
    attempted: true,
    hits,
    lines: buildObRecallLines(hits),
    error: client.getLastError()
  };
}
