import type { ChatMessage, Persona } from '../types/domain';
import type { AssistantRequestContext, AssistantRequestTool } from './request/requestContext';
import {
  describeProactiveDecisionMessages,
  extractJsonObjectText,
  formatDecisionClock
} from './proactiveDecision';

/**
 * 来电判断层：在用户按下「语音通话」之后、麦克风打开之前，先让协作者本人决定接不接。
 *
 * 和主动消息的决策层（`proactiveDecision`）是同一套路：一次独立、轻量的补全，
 * 只读人格设定和最近的对话，不写进可见的聊天记录，也不真的执行工具。区别只在语义和
 * 兜底方向——主动消息判断失败时照常发声，而来电判断失败时接不上（见 runner）。
 *
 * 判断不再让模型写自由文本，而是给它一个真的「接听 / 拒接」工具（`answerVoiceCall`）
 * 并强制它调用：不接是一个显式选项，而不是需要模型自己"想起来"的措辞。
 * 文本 JSON 那条路保留着，因为个别 provider 会把原生工具降级掉（见 chatApi 的兼容分支）。
 */

/** 拒接留言的长度上限：屏幕上那行字，太长就不像随手说的了。 */
export const INCOMING_CALL_MAX_LINE_CHARS = 60;

/** 判断依据的长度上限。 */
export const INCOMING_CALL_MAX_REASON_CHARS = 200;

/** 人设提示词带进来时的截断长度，避免一次判断把上下文撑爆。 */
export const INCOMING_CALL_MAX_PERSONA_PROMPT_CHARS = 6000;

/** 最近对话取多少条给判断层看。 */
export const INCOMING_CALL_MAX_CONTEXT_MESSAGES = 12;

/** 判断层唯一的工具名。叫「接听」是因为它本来就是接听这个动作本身。 */
export const INCOMING_CALL_ANSWER_TOOL_NAME = 'answerVoiceCall';

/**
 * 判断层的「接听 / 拒接」按钮。
 *
 * 之前这一层让模型写自由文本 JSON，结果是模型经常含糊其辞、读不出结论就当接不上。
 * 给它一个真的工具，`accept` 就成了必须填的字段——不接是摆在那里的选项，
 * 而不是要模型自己"想起来"才能表达的东西。
 */
export function buildIncomingCallAnswerTool(): AssistantRequestTool {
  return {
    type: 'function',
    function: {
      name: INCOMING_CALL_ANSWER_TOOL_NAME,
      description: '给出这通来电的结论：接听，还是不接。必须调用它一次。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          accept: {
            type: 'boolean',
            description: 'true = 接这通电话；false = 不接。'
          },
          reason: {
            type: 'string',
            description: '一句话说明你为什么接 / 为什么不接。'
          },
          line: {
            type: 'string',
            description: `不接时留给对方看的一句短话（不超过 ${INCOMING_CALL_MAX_LINE_CHARS} 个字符）。决定接听时留空字符串。`
          }
        },
        required: ['accept', 'line']
      }
    }
  };
}

export type IncomingCallDecision = {
  /** 接，还是不接。 */
  accept: boolean;
  /** 不接时给用户看的那句短话；接听时为空。 */
  line: string;
  /** 一句话判断依据，用于排查。 */
  reason: string;
};

export const INCOMING_CALL_DECISION_SYSTEM_PROMPT = [
  '你正在扮演一个人。下面会告诉你这个人是谁、性格如何、正过着什么样的生活。',
  '现在，这个人的手机响了——对方打来了一通语音电话。你要以这个人的身份决定：接，还是不接。',
  '',
  '判断的依据不是礼貌，而是「像不像你」：',
  '- 想接就接。看到是谁打来的、想起你们正聊到一半的事、心情不错、正好想找他说话，都可以是接的理由。',
  '- 不想接就不接。在忙、在睡、不方便开口、心情不对、关系正别扭、或者单纯就是不想，也都可以是不接的理由。',
  '- 但别为了显得有个性就刻意拒接，也别为了客气勉强自己接。偶尔不接才像真的，每次都拒接只会让人觉得你在躲着他。',
  '',
  '不接的时候要留一句话给对方看，那是屏幕上那行「为什么没接」。用你自己的口吻写，短、随意、像随手打的，不要提系统、不要写解释性的旁白。',
  '',
  '你必须调用 answerVoiceCall 工具来给出结论。',
  '这个工具就是「接听/拒接」这个动作本身：accept 决定接不接（true=接，false=不接），reason 写一句你为什么这么决定，line 是不接时留给对方看的那句话。',
  '不要用一句自然语言代替工具调用——先调用工具，把结论放进它的参数里。',
  '',
  '只有当运行环境完全禁止你调用任何工具时，才退一步，只输出一个 JSON 对象（字段完全一样）：',
  '{"accept": true 或 false, "reason": "一句话", "line": "不接时的留言，接听时留空"}',
  '这种情况下不要输出 JSON 以外的任何内容，不要用 Markdown 代码块包裹，不要写解释性的话。',
  '哪怕你只想简单表个态，也必须落到 accept 这个字段上——它是这通电话接不接的唯一依据。'
].join('\n');

export type IncomingCallDecisionPromptArgs = {
  persona: Persona;
  messages: ChatMessage[];
  now: number;
};

/** 把人格设定压成一段「你是谁」，让判断发生在正确的那个人的立场上。 */
export function buildIncomingCallPersonaContent(persona: Persona) {
  const name = persona.name.trim() || '协作者';
  const userName = persona.userName.trim() || '用户';
  const compiled = persona.compiledPrompt?.trim() ?? '';
  const description = persona.description?.trim() ?? '';
  const clipped = compiled.length > INCOMING_CALL_MAX_PERSONA_PROMPT_CHARS
    ? `${compiled.slice(0, INCOMING_CALL_MAX_PERSONA_PROMPT_CHARS)}\n（人设过长，以上已截断。）`
    : compiled;

  const lines = [
    '# 你是谁',
    `你是「${name}」，正在和你的人「${userName}」相处。下面是你自己的人设，请按它来判断，也按它来说话。`,
    description ? `你自己的定位：${description}` : null,
    clipped
  ].filter((line): line is string => Boolean(line));

  return lines.join('\n');
}

export function buildIncomingCallDecisionPrompt(args: IncomingCallDecisionPromptArgs) {
  const name = args.persona.name.trim() || '协作者';
  const userName = args.persona.userName.trim() || '用户';
  const recent = describeProactiveDecisionMessages({
    messages: args.messages,
    collaboratorName: name,
    userName,
    limit: INCOMING_CALL_MAX_CONTEXT_MESSAGES
  });

  return [
    `当前时间：${formatDecisionClock(args.now)}`,
    `打电话来的人：${userName}。电话正在响，还没人接。`,
    '',
    '你们最近的对话记录（从旧到新，可能被截断）：',
    recent.length > 0 ? recent.join('\n') : '（最近没有聊过什么。）',
    '',
    `请以「${name}」的身份决定：现在接这通电话，还是不接。`,
    `请调用 ${INCOMING_CALL_ANSWER_TOOL_NAME} 工具，把结论放进它的参数里。`,
    '只有运行环境完全禁止调用工具时，才严格输出下面这个 JSON 结构：',
    '{"accept": true 或 false, "reason": "一句话说明你为什么接 / 为什么不接", "line": "不接时写一句给对方看的短话，决定接听时用空字符串"}',
    `line 不要超过 ${INCOMING_CALL_MAX_LINE_CHARS} 个字符。`
  ].join('\n');
}

export function buildIncomingCallDecisionRequestContext(
  args: IncomingCallDecisionPromptArgs
): AssistantRequestContext {
  return {
    memorySlots: {
      session: [],
      profile: [],
      pin: []
    },
    attachmentSlots: {
      enabled: false,
      pending: []
    },
    segments: [
      {
        kind: 'system',
        messages: [{
          role: 'system',
          content: INCOMING_CALL_DECISION_SYSTEM_PROMPT
        }]
      },
      {
        kind: 'system',
        messages: [{
          role: 'system',
          content: buildIncomingCallPersonaContent(args.persona)
        }]
      },
      {
        kind: 'conversation',
        messages: [{
          role: 'user',
          content: buildIncomingCallDecisionPrompt(args)
        }]
      }
    ],
    tools: [buildIncomingCallAnswerTool()],
    // 判断层只有一个动作可选，所以「必须调用」比「可以调用」更贴切：
    // 模型没有"不回答"这个选项，含糊其辞也就无处可躲。
    toolChoice: 'required'
  };
}

const ACCEPT_TRUE_TOKENS = new Set(['true', 'yes', 'accept', 'answer', 'pick', '1', '接', '接听', '接吧']);
const ACCEPT_FALSE_TOKENS = new Set(['false', 'no', 'reject', 'decline', 'skip', 'ignore', '0', '不接', '拒接', '拒绝']);

/** 容错地读 accept 字段：接受布尔、0/1、以及常见的字符串写法（含中文）。 */
function normalizeAcceptFlag(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return value !== 0;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (ACCEPT_TRUE_TOKENS.has(normalized)) return true;
    if (ACCEPT_FALSE_TOKENS.has(normalized)) return false;
  }
  return null;
}

function normalizeDecisionText(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

/**
 * JSON 解析失败时的兜底：只在文字里有明确的 accept 布尔时才下结论。
 *
 * 之所以敢读这种半截输出，是因为这里的兜底方向和别处相反——读不出来是「接不上电话」，
 * 比误判成「拒接」更打扰用户；所以宁可多读一层，也不轻易放弃一次正常的通话。
 */
function readAcceptFromLooseText(text: string): boolean | null {
  const matched = text.match(/accept\s*["']?\s*[:：]\s*["']?(true|false|yes|no|1|0)/i);
  if (matched?.[1]) return normalizeAcceptFlag(matched[1]);
  return null;
}

/**
 * 自然语言里的明确拒绝意图。
 *
 * 第三方模型（MiniMax / DeepSeek / SiliconFlow / OpenRouter 等）不支持 `tool_choice: required`，
 * 判断层的工具会被降级成 `auto`，模型常常干脆不调工具、直接用一句话表态。这种时候
 * 「接不接」藏在自然语言里，不在这里识别，就会把一次明确的拒绝误判成「无法接通」。
 *
 * 只匹配**否定式**表达（"不接""拒接""不想""在忙""不方便""没空"等），
 * 不匹配肯定式——因为"接不上"（unreachable）比"误接"更打扰用户，宁可让肯定式
 * 走原逻辑，也不在这里反向猜测"它其实是接"。
 */
const DECLINE_INTENT_PATTERNS = [
  /不(?:想|能|方便)?接/,
  /拒接/,
  /不接(?:这通|电话)?/,
  /先不接/,
  /回头再说/,
  /在忙/,
  /没空/,
  /不方便(?:接|说话|开口)/,
  /不想接/,
  /不聊了/,
  /挂了/,
  /(?:现在|这会儿)?不(?:方便|行)/,
  /稍后(?:再|回)/
];

function readDeclineFromNaturalLanguage(text: string): boolean | null {
  const normalized = text.trim();
  if (!normalized) return null;
  // 长度护栏：判断层输出不该太长；超过一条短信的长度就说明不是单纯的一句表态，
  // 别硬从里面抠"拒接"。
  if (normalized.length > 240) return null;
  return DECLINE_INTENT_PATTERNS.some((pattern) => pattern.test(normalized)) ? false : null;
}

/**
 * DeepSeek-V4 系列（deepseek-flash / v4 / v4-pro）把工具调用从 JSON 改成了 DSML——
 * 一种嵌在 `content` 文本里的 XML 式标记，而不是标准 OpenAI 的 `tool_calls` 字段。
 * 模型「以为」自己在调工具，但输出落到文本里，导致上层 `nativeToolCalls` 为空、
 * 判断被误判成「接不上」。这里从文本里把 `answerVoiceCall` 的参数抠出来。
 *
 * 实际输出长这样（`|` 可能是半角 `|` 或全角 `｜`）：
 *   <|DSML|invoke name="answerVoiceCall">
 *   <|DSML|parameter name="accept" string="false">true</|DSML|parameter>
 *   <|DSML|parameter name="line" string="true"></|DSML|parameter>
 *   </|DSML|invoke>
 *
 * 只认 `answerVoiceCall` 这一个工具（这一层唯一的动作），其它工具名直接忽略。
 */
function readAnswerFromDsml(text: string): IncomingCallDecision | null {
  // 半角 / 全角竖线都归一化成半角，后面正则就不用写两套。
  const normalized = text.replace(/｜/g, '|').replace(/\s+/g, ' ');

  const invokeOpen = /<\|DSML\|\s*invoke\s+name\s*=\s*["']answerVoiceCall["'][^>]*>/i;
  const invokeIndex = normalized.search(invokeOpen);
  if (invokeIndex < 0) return null;

  // 截到 </|DSML|invoke> 为止，只在这个块里找参数。
  const block = normalized.slice(invokeIndex);
  const closeIndex = block.search(/<\/\|DSML\|\s*invoke\s*>/i);
  const scoped = closeIndex >= 0 ? block.slice(0, closeIndex) : block;

  // 抓每个 <|DSML|parameter name="X" ...>值</|DSML|parameter>，值可能是字符串或裸文本。
  const paramPattern = /<\|DSML\|\s*parameter\s+name\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/\|DSML\|\s*parameter\s*>/gi;

  const params = new Map<string, string>();
  let match: RegExpExecArray | null;
  while ((match = paramPattern.exec(scoped)) !== null) {
    const name = (match[1] ?? '').trim();
    const rawValue = (match[2] ?? '').trim();
    // 值可能被包在字符串引号里（`string="true"` 里的引号只出现在属性上，正文一般裸着）。
    params.set(name, rawValue.replace(/^["']|["']$/g, ''));
  }

  const accept = normalizeAcceptFlag(params.get('accept'));
  if (accept === null) return null;

  const reason = normalizeDecisionText(params.get('reason') ?? '', INCOMING_CALL_MAX_REASON_CHARS);
  if (!accept) {
    return {
      accept: false,
      line: normalizeDecisionText(params.get('line') ?? params.get('message') ?? '', INCOMING_CALL_MAX_LINE_CHARS),
      reason
    };
  }
  return { accept: true, line: '', reason };
}

/**
 * 有些模型不写 DSML，而是把工具调用写成伪函数文本：`answerVoiceCall(accept=false, ...)`。
 * 这是「工具没被真正调起来」的另一种表现，同样从文本里抠参数。
 */
function readAnswerFromPseudoFunction(text: string): IncomingCallDecision | null {
  const match = text.match(/answerVoiceCall\s*\(\s*([\s\S]*?)\s*\)/i);
  if (!match?.[1]) return null;

  const body = match[1];
  // 按逗号拆参数，但值里可能带逗号（reason 里常见）。用「键=」边界拆更稳。
  const params = new Map<string, string>();
  const kvPattern = /([A-Za-z_][A-Za-z0-9_]*)\s*=\s*("(?:\\.|[^"])*"|'(?:\\.|[^'])*'|[^,]*)/g;
  let kv: RegExpExecArray | null;
  while ((kv = kvPattern.exec(body)) !== null) {
    const key = kv[1].trim();
    let value = kv[2].trim();
    if (value.startsWith('"') || value.startsWith("'")) {
      try {
        value = JSON.parse(value);
      } catch {
        value = value.replace(/^["']|["']$/g, '');
      }
    }
    params.set(key, value);
  }

  const accept = normalizeAcceptFlag(params.get('accept'));
  if (accept === null) return null;

  const reason = normalizeDecisionText(params.get('reason') ?? '', INCOMING_CALL_MAX_REASON_CHARS);
  if (!accept) {
    return {
      accept: false,
      line: normalizeDecisionText(params.get('line') ?? params.get('message') ?? '', INCOMING_CALL_MAX_LINE_CHARS),
      reason
    };
  }
  return { accept: true, line: '', reason };
}

/**
 * 解析判断层输出。读不出来时返回 null——它意味着「这通电话接不上」，
 * 由调用方决定怎么呈现，而不是在这里替用户拍一个默认答案。
 *
 * 优先级：结构化 JSON → DSML 工具调用 → 伪函数调用 → 散落的 accept 字段 → 自然语言拒绝。
 * DSML / 伪函数放在 JSON 之后、自然语言之前，因为它们是「模型确实想调工具、
 * 只是格式没被上层转成 nativeToolCalls」的确定性信号，比从一句人话里猜意图可靠。
 */
export function parseIncomingCallDecisionOutput(text: string): IncomingCallDecision | null {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(extractJsonObjectText(text));
  } catch {
    parsed = null;
  }

  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const record = parsed as Record<string, unknown>;
    const accept = normalizeAcceptFlag(record.accept ?? record.answer ?? record.pick);
    if (accept !== null) {
      const reason = normalizeDecisionText(record.reason, INCOMING_CALL_MAX_REASON_CHARS);
      if (!accept) {
        return {
          accept: false,
          line: normalizeDecisionText(record.line ?? record.message, INCOMING_CALL_MAX_LINE_CHARS),
          reason
        };
      }
      return { accept: true, line: '', reason };
    }
  }

  // DeepSeek-V4 的 DSML 工具调用：模型在"调工具"，只是格式是文本标记。
  const fromDsml = readAnswerFromDsml(text);
  if (fromDsml) return fromDsml;

  // 伪函数调用：answerVoiceCall(accept=...)。
  const fromPseudo = readAnswerFromPseudoFunction(text);
  if (fromPseudo) return fromPseudo;

  const looseAccept = readAcceptFromLooseText(text);
  if (looseAccept !== null) {
    return looseAccept
      ? { accept: true, line: '', reason: '' }
      : { accept: false, line: '', reason: '' };
  }

  // 工具没被调用、也没有 JSON 时，退一步读自然语言里的明确拒绝。
  // 读得出"不想接"就记成拒绝；读不出才是 null（= 无法接通）。
  const declinedFromText = readDeclineFromNaturalLanguage(text);
  if (declinedFromText !== null) {
    return { accept: false, line: '', reason: '' };
  }

  return null;
}
