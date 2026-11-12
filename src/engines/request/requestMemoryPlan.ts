import { buildMemorySegmentLines, buildWeightedMemoryLines, describeMemoryItem } from '../memoryEngine';
import type { PersonaMemorySettings } from '../../types/domain';
import { estimateTextTokens } from './requestTokenEstimation';

export type AssistantMemoryLineDecision = {
  text: string;
  estimatedTokens: number;
  status: 'kept' | 'dropped_budget' | 'dropped_irrelevant';
};

export type AssistantRequestMemoryPlan = {
  selectedLines: string[];
  /**
   * 拆成两半，是因为它们该待的位置不同：
   * 常驻（coreLines）变化少，留在系统提示里当稳定前缀；
   * 按需选中的（relevantLines）每轮都可能不同，放进「最后一条用户消息之前」，
   * 否则系统提示一改，后面整段对话的缓存全部作废。
   */
  coreLines?: string[];
  relevantLines?: string[];
  estimatedTokens: number;
  maxTokens: number | null;
  status: 'empty' | 'within_budget' | 'trimmed_budget';
  entries: AssistantMemoryLineDecision[];
};

export type InheritedMemorySource = {
  id: string;
  memory: PersonaMemorySettings;
};

/** 常驻记忆的条数上限：名字/生日/关系这类，永远带着。 */
export const DEFAULT_CORE_LINE_LIMIT = 3;

/** 默认挑常驻时优先看这些字眼（**按顺序**：越靠前越像"必须永远记得的事"）。 */
const CORE_KEYWORDS = ['名字', '生日', '关系', '家人', '过敏', '习惯', '喜欢', '讨厌', '工作'];

/**
 * 记忆的"身份"：用记忆引擎自己那套规范化，别再造一套（两套规则会互相打脸）。
 * 解析不出来时返回空串——**空身份永远不参与匹配**，否则两条解析失败的记忆会被当成同一条。
 */
export function memoryIdentity(line: string) {
  return describeMemoryItem(line)?.normalizedText ?? '';
}

/** 默认挑常驻：先按关键词优先级挑，不够再按权重补。 */
function pickDefaultCoreLines(weightedLines: string[], limit: number): string[] {
  if (limit <= 0) return [];
  const scored = weightedLines
    .map((line) => {
      const matched = CORE_KEYWORDS.findIndex((keyword) => line.includes(keyword));
      return { line, priority: matched === -1 ? CORE_KEYWORDS.length : matched };
    })
    .sort((left, right) => left.priority - right.priority);
  return scored.slice(0, limit).map((entry) => entry.line);
}

const CJK_PATTERN = /[\u4e00-\u9fff]/;

/** 这些字太常见，单字命中没有区分度（"到了" 的 "了" 会把养猫的记忆也拉进来）。 */
const CJK_STOP_CHARS = new Set(
  Array.from('的了着是我你他她它们在和与就都也很要会能想把被给对说到过什么这那个一不上下里吧呢啊吗么还又就才再')
);

/**
 * 这条记忆跟用户这句话有没有关系。
 *
 * 故意**放得很宽**（共享任意一个汉字就算）：中文短词靠子串会漏
 * （"过生" 匹配不到 "生日"），而这一步只是过渡，等 OB 的语义检索接上再收紧。
 */
export function memoryLineMatchesFocus(line: string, focus: string): boolean {
  const normalizedLine = line.toLowerCase();
  const normalizedFocus = focus.toLowerCase().trim();
  if (!normalizedFocus) return true;
  if (normalizedLine.includes(normalizedFocus) || normalizedFocus.includes(normalizedLine)) return true;

  // 拉丁词：≥2 个字符才算
  const latinTokens = normalizedFocus.split(/[^a-z0-9]+/).filter((token) => token.length >= 2);
  if (latinTokens.some((token) => normalizedLine.includes(token))) return true;

  // 中文：共享任意一个汉字就算相关
  for (const char of normalizedFocus) {
    if (!CJK_PATTERN.test(char) || CJK_STOP_CHARS.has(char)) continue;
    if (normalizedLine.includes(char)) return true;
  }
  return false;
}

function estimateMemorySegmentTokens(lines: string[]) {
  if (!lines.length) return 0;
  return estimateTextTokens([
    '以下是当前协作者可调用的长期记忆线索。',
    '只在相关时自然使用，不要逐条复述，也不要把它们说成系统说明。',
    ...buildMemorySegmentLines(lines)
  ].join('\n'));
}

export function resolveRequestMemoryPlan(args: {
  memory?: PersonaMemorySettings;
  inheritedMemorySources?: InheritedMemorySource[];
  maxTokens: number | null;
  /** 用户这一轮说的话：只有跟它相关的记忆才会带上（常驻的除外）。 */
  focusText?: string;
  /** 常驻记忆条数，默认 3。 */
  coreLineLimit?: number;
  /** 用户手动标成「常驻」的记忆（记忆页的开关）。 */
  coreMemories?: string[];
}): AssistantRequestMemoryPlan {
  const inheritedLines = args.memory?.inheritGlobal === false
    ? []
    : (args.inheritedMemorySources ?? [])
        .filter((source) => !args.memory?.excludedGlobalIds.includes(source.id))
        .filter((source) => source.memory.excludeFromGlobal !== true)
        .flatMap((source) => source.memory.personalMemories);
  const weightedLines = buildWeightedMemoryLines([
    ...(args.memory?.personalMemories ?? []),
    ...inheritedLines
  ].map((line) => line.trim()).filter(Boolean));
  if (!weightedLines.length) {
    return {
      selectedLines: [],
      coreLines: [],
      relevantLines: [],
      estimatedTokens: 0,
      maxTokens: args.maxTokens,
      status: 'empty',
      entries: []
    };
  }

  // 常驻：用户手动勾的优先；没勾过就默认挑（先看关键词，不够再按权重补）
  const coreLimit = Math.max(0, Math.floor(args.coreLineLimit ?? DEFAULT_CORE_LINE_LIMIT));
  const focus = (args.focusText ?? '').trim();
  // 手动勾的按"规范化文本"对上（weightedLines 里的行可能被裁过空白/标点）
  const explicitCore = (args.coreMemories ?? args.memory?.coreMemories ?? [])
    .map((line) => line.trim())
    .filter(Boolean)
    // 只认"身份完全相同"（用引擎的 normalizedText）：不放宽成相似匹配，
    // 宁可对不上（UI 会提示失效），也不要错绑。
    .map((line) => {
      const target = memoryIdentity(line);
      if (!target) return undefined;
      return weightedLines.find((candidate) => memoryIdentity(candidate) === target);
    })
    .filter((line): line is string => Boolean(line));
  const coreLines = (explicitCore.length
    ? explicitCore
    : pickDefaultCoreLines(weightedLines, coreLimit)
  ).slice(0, Math.max(coreLimit, explicitCore.length));
  const restLines = weightedLines.filter((line) => !coreLines.includes(line));
  // 没有 focus（只发了图片/表情包、或者这条消息没正文）时**不要退回"全带"**——
  // 那就等于把省下的 token 又吐回去。这时只带常驻。
  const relevantLines = focus
    ? restLines.filter((line) => memoryLineMatchesFocus(line, focus))
    : [];
  const irrelevantLines = focus
    ? restLines.filter((line) => !relevantLines.includes(line))
    : restLines;
  const selectedCandidates = [...coreLines, ...relevantLines];

  if (args.maxTokens === null) {
    return {
      selectedLines: selectedCandidates,
      coreLines,
      relevantLines,
      estimatedTokens: estimateMemorySegmentTokens(selectedCandidates),
      maxTokens: null,
      status: 'within_budget',
      entries: [
        ...selectedCandidates.map((text) => ({
          text,
          estimatedTokens: estimateTextTokens(text),
          status: 'kept' as const
        })),
        ...irrelevantLines.map((text) => ({
          text,
          estimatedTokens: estimateTextTokens(text),
          status: 'dropped_irrelevant' as const
        }))
      ]
    };
  }

  const selectedLines: string[] = [];
  const entries: AssistantMemoryLineDecision[] = [];

  for (const line of selectedCandidates) {
    const nextLines = [...selectedLines, line];
    const nextTokens = estimateMemorySegmentTokens(nextLines);
    if (selectedLines.length > 0 && nextTokens > args.maxTokens) {
      entries.push({
        text: line,
        estimatedTokens: estimateTextTokens(line),
        status: 'dropped_budget'
      });
      continue;
    }

    selectedLines.push(line);
    entries.push({
      text: line,
      estimatedTokens: estimateTextTokens(line),
      status: 'kept'
    });
  }

  entries.push(...irrelevantLines.map((text) => ({
    text,
    estimatedTokens: estimateTextTokens(text),
    status: 'dropped_irrelevant' as const
  })));

  return {
    selectedLines,
    // 预算裁剪后仍要拆开：留下的常驻继续待在系统提示里，其余挪到用户消息前
    coreLines: selectedLines.filter((line) => coreLines.includes(line)),
    relevantLines: selectedLines.filter((line) => !coreLines.includes(line)),
    estimatedTokens: estimateMemorySegmentTokens(selectedLines),
    maxTokens: args.maxTokens,
    status: entries.some((entry) => entry.status === 'dropped_budget') ? 'trimmed_budget' : 'within_budget',
    entries
  };
}
