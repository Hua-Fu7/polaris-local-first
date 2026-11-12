type InlineThinkingReply = {
  content: string;
  thinkingText?: string;
};

export type InlineThinkingTagParseResult = {
  visibleContent: string;
  thinkingTexts: string[];
};

export type InlineThinkingTagParseOptions = {
  /**
   * 流式解析。
   *
   * 流式期间思考段还没写完，闭合标签根本还没到——这时如果把标签后面的内容当正文，
   * 思考就会先"写到外面"，等闭合标签到了再被收进思考区，正文里闪一下又收走。
   * 所以流式模式下：**没闭合的标签之后一律算思考**。
   *
   * 最终解析（默认，非流式）保持原来的保守策略：没有闭合标签就当普通文本，
   * 免得模型在正文里提到 `<think>` 这个词时把整段回答吞掉。
   */
  streaming?: boolean;
};

const OPEN_TAG_PATTERN = /<\s*(think|thinking|thought)\s*>/gi;

/**
 * 行尾那个"还没写完的思考标签"。
 *
 * 流式期间 `&lt;think` 会一个字符一个字符地到，到达 `&lt;` `&lt;t` 这种半截状态时
 * 正则匹配不到完整标签，于是半截标签本身会被当正文渲染出来。这里把这种尾巴摘掉
 * （下个 tick 标签完整了就自然走到思考分支）。
 */
const PARTIAL_THINK_TAG_TAIL_PATTERN = /<\s*\/?\s*t(?:h(?:i(?:n(?:k(?:i(?:n(?:g)?)?)?)?)?|o(?:u(?:g(?:h(?:t)?)?)?)?)?)?$/i;

function createCloseTagPattern(tagName: string) {
  return new RegExp(`<\\s*/\\s*${tagName}\\s*>`, 'i');
}

function stripPartialThinkTagTail(value: string) {
  return value.replace(PARTIAL_THINK_TAG_TAIL_PATTERN, '');
}

function appendThinkingText(existing: string | undefined, additions: string[]) {
  const existingText = existing?.trim();
  const addedText = additions
    .map((text) => text.trim())
    .filter(Boolean)
    .join('\n\n');
  if (!addedText) return existing;
  return existingText ? `${existingText}\n\n${addedText}` : addedText;
}

export function parseInlineThinkingTags(
  input: string,
  options: InlineThinkingTagParseOptions = {}
): InlineThinkingTagParseResult {
  const streaming = options.streaming === true;
  const visible: string[] = [];
  const thinkingTexts: string[] = [];
  let cursor = 0;

  while (cursor < input.length) {
    OPEN_TAG_PATTERN.lastIndex = cursor;
    const openMatch = OPEN_TAG_PATTERN.exec(input);
    if (!openMatch) {
      visible.push(input.slice(cursor));
      break;
    }

    const openStart = openMatch.index;
    const openEnd = openStart + openMatch[0].length;
    const tagName = openMatch[1].toLowerCase();
    const closeMatch = createCloseTagPattern(tagName).exec(input.slice(openEnd));

    if (!closeMatch) {
      if (streaming) {
        // 标签还没闭合 = 思考正在写：标签之前是正文，标签之后全是思考。
        visible.push(input.slice(cursor, openStart));
        const pendingThinking = stripPartialThinkTagTail(input.slice(openEnd)).trim();
        if (pendingThinking) {
          thinkingTexts.push(pendingThinking);
        }
      } else {
        visible.push(input.slice(cursor));
      }
      break;
    }

    const closeStart = openEnd + closeMatch.index;
    const closeEnd = closeStart + closeMatch[0].length;
    const thinkingText = input.slice(openEnd, closeStart).trim();

    visible.push(input.slice(cursor, openStart));
    if (thinkingText) {
      thinkingTexts.push(thinkingText);
    }
    cursor = closeEnd;
  }

  const visibleContent = streaming
    ? stripPartialThinkTagTail(visible.join('')).trim()
    : visible.join('').trim();

  return {
    visibleContent,
    thinkingTexts
  };
}

export function promoteInlineThinkingTags<T extends InlineThinkingReply>(
  reply: T,
  options: InlineThinkingTagParseOptions = {}
): T {
  const parsed = parseInlineThinkingTags(reply.content, options);
  if (parsed.thinkingTexts.length === 0) {
    // 非流式：没有完整的思考段就原样返回，连首尾空白都不碰。
    if (options.streaming !== true) return reply;
    // 流式：即使思考段还空着，正文也可能因为摘掉半截标签而变化，这时要落盘。
    if (parsed.visibleContent === reply.content.trim()) return reply;
  }
  return {
    ...reply,
    content: parsed.visibleContent,
    thinkingText: appendThinkingText(reply.thinkingText, parsed.thinkingTexts)
  };
}
