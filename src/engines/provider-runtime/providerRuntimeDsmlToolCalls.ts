import type { OpenAiToolCallAccumulator } from './providerRuntimeReplyAccumulator';

/**
 * DeepSeek-V4 系列（deepseek-flash / v4 / v4-pro）的工具调用协议。
 *
 * 这些模型不吐标准 OpenAI 的 `delta.tool_calls` 字段，而是把工具调用写成一段
 * XML 式的 DSML 文本，直接嵌在 `content` 里。模型"以为"自己在调工具，但上层
 * 只按标准 `tool_calls` 字段解析，于是：
 * - 工具根本没执行（比如 startVoiceCall / hangUp 永不触发）；
 * - DSML 标记被当成正文渲染出来，用户看到一大串 `<|DSML|...` 代码。
 *
 * 实际输出长这样（`|` 可能是半角 `|` 或全角 `｜`）：
 *   <|DSML|calls>
 *   <|DSML|invoke name="hangUp">
 *   <|DSML|parameter name="reason" string="true">说完了</|DSML|parameter>
 *   </|DSML|invoke>
 *   </|DSML|calls>
 *
 * 这里做的：从 content 里识别出完整的 DSML invoke 块，转成标准
 * `OpenAiToolCallAccumulator`（name + argumentsText），并把 DSML 标记从正文里剥掉。
 * 这样下游的工具解析链（assistantToolProtocol）就能像处理标准 tool_calls 一样处理它们。
 *
 * 只认「完整」的块（有开有闭），半截的 DSML（比如流式中间态）留给下一次。
 * 只做纯文本处理，不依赖 provider 身份——DSML 标记足够特异，误伤概率可忽略。
 */

const PARAM_NAME_PATTERN = /name\s*=\s*["']([^"']+)["']/i;
const PARAM_STRING_PATTERN = /string\s*=\s*["'](true|false)["']/i;

/** 把全角竖线归一化成半角，后续正则不用写两套。 */
function normalizeDsmlText(text: string) {
  return text.replace(/｜/g, '|');
}

/** 找到第一个 DSML invoke 块的起始（含归一化后的文本与原始偏移无关，因为只做提取不做事后拼接）。 */
function findInvokeStart(text: string) {
  const match = text.match(/<\|DSML\|\s*invoke\s+name\s*=\s*["']([^"']+)["'][^>]*>/i);
  if (!match) return null;
  return { name: match[1].trim(), index: match.index ?? 0, openTag: match[0] };
}

/** 从 invoke 块内部抠参数：<|DSML|parameter name="X" string="true">值</|DSML|parameter>。 */
function parseDsmlInvokeParams(blockBody: string): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  const paramPattern = /<\|DSML\|\s*parameter\s+([^>]*)>([\s\S]*?)<\/\|DSML\|\s*parameter\s*>/gi;
  let match: RegExpExecArray | null;
  while ((match = paramPattern.exec(blockBody)) !== null) {
    const attrs = match[1] ?? '';
    const nameMatch = attrs.match(PARAM_NAME_PATTERN);
    if (!nameMatch?.[1]) continue;
    const name = nameMatch[1].trim();
    const rawValue = (match[2] ?? '').trim();
    const stringFlag = attrs.match(PARAM_STRING_PATTERN)?.[1];
    const isString = stringFlag === 'true';
    if (isString) {
      // string="true"：值就是字面字符串，剥掉可能的外层引号。
      params[name] = rawValue.replace(/^["']|["']$/g, '');
    } else {
      // string="false"：值应是 JSON（数字/布尔/数组/对象）。解析失败就退回裸文本，
      // 至少别把工具调用整个弄丢。
      try {
        params[name] = JSON.parse(rawValue);
      } catch {
        params[name] = rawValue;
      }
    }
  }
  return params;
}

/** 解析单个 invoke 块，返回工具名和参数对象；块不完整时返回 null。 */
function parseDsmlInvoke(text: string) {
  const start = findInvokeStart(text);
  if (!start) return null;

  // 截到 </|DSML|invoke> 为止；没有闭合标记就说明块还没收完（流式中间态）。
  const afterOpen = text.slice(start.index);
  const closeIndex = afterOpen.search(/<\/\|DSML\|\s*invoke\s*>/i);
  if (closeIndex < 0) return null;

  const blockBody = afterOpen.slice(start.openTag.length, closeIndex);
  const params = parseDsmlInvokeParams(blockBody);
  return { name: start.name, params };
}

/**
 * 从 content 里提取所有 DSML 工具调用，并返回剥离 DSML 后的干净正文。
 *
 * 返回值：
 * - toolCalls：转成标准结构的工具调用（argumentsText 是 JSON 字符串）。
 * - cleanContent：去掉 DSML 块后的正文（多个块、前后正文都保留）。
 * - extracted：是否真的提取到了东西（没有 DSML 时原样返回）。
 *
 * 说明：在归一化文本上直接提取和删除（全角竖线→半角是一对一替换，长度不变），
 * 正文里偶发的全角竖线会被保留为半角，属于可接受的极低概率代价，远低于
 * 维护「原文偏移 + 归一化偏移」双索引的复杂度。
 */
export function extractDsmlToolCallsFromContent(content: string): {
  toolCalls: OpenAiToolCallAccumulator[];
  cleanContent: string;
  extracted: boolean;
} {
  const text = normalizeDsmlText(content);
  const toolCalls: OpenAiToolCallAccumulator[] = [];
  const removed: Array<{ start: number; end: number }> = [];

  let searchFrom = 0;
  for (let guard = 0; guard < 64; guard += 1) {
    const start = findInvokeStart(text.slice(searchFrom));
    if (!start) break;

    const absoluteStart = searchFrom + start.index;
    const afterOpen = text.slice(absoluteStart);
    const closeMatch = afterOpen.match(/<\/\|DSML\|\s*invoke\s*>/i);
    if (!closeMatch || closeMatch.index === undefined) break;

    const closeIndex = absoluteStart + closeMatch.index;
    const blockEnd = closeIndex + closeMatch[0].length;
    const blockBody = text.slice(absoluteStart + start.openTag.length, closeIndex);
    const params = parseDsmlInvokeParams(blockBody);

    toolCalls.push({
      name: start.name,
      argumentsText: JSON.stringify(params)
    });
    removed.push({ start: absoluteStart, end: blockEnd });
    searchFrom = blockEnd;
  }

  if (toolCalls.length === 0) {
    return { toolCalls, cleanContent: content, extracted: false };
  }

  // 按顺序拼接出干净正文：保留块与块之间的空隙。
  let cleanContent = '';
  let cursor = 0;
  for (const range of removed) {
    cleanContent += text.slice(cursor, range.start);
    cursor = range.end;
  }
  cleanContent += text.slice(cursor);

  // 外层容器标记可能残留（官方写 `tool_calls`，中转常见 `calls`），一并清掉。
  cleanContent = cleanContent
    .replace(/<\|DSML\|\s*(?:tool_)?calls\s*>/gi, '')
    .replace(/<\/\|DSML\|\s*(?:tool_)?calls\s*>/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return {
    toolCalls,
    cleanContent,
    extracted: true
  };
}
