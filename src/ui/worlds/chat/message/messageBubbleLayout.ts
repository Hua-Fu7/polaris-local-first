/**
 * 助手回复在渲染层怎么拆成气泡。
 *
 * 切气泡是纯展示诉求，所以放在渲染层做，不去动数据层：真把一条回复拆成多条
 * 消息会连带改掉送给模型的上下文结构（多条 assistant 消息 vs 一条）、token
 * 统计和持久化格式，代价远大于这个视觉效果本身。
 */

/**
 * markdown 分块时用到的「块类型」。
 * - text：普通段落，以及标题、加粗这类行内样式——它们拆开不影响语义。
 * - fence：``` / ~~~ 围栏代码块。
 * - list：有序 / 无序列表。
 * - table：表格行。
 * - quote：引用行。
 */
type BlockKind = 'text' | 'fence' | 'list' | 'table' | 'quote';

const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/;
const TABLE_RE = /^\s{0,3}\|/;
const UNORDERED_LIST_RE = /^\s{0,3}[-*+]\s+/;
const ORDERED_LIST_RE = /^\s{0,3}\d+[.)]\s+/;
const QUOTE_RE = /^\s{0,3}>\s?/;
const DETAILS_START_RE = /^\s*<details\b/i;
const DETAILS_END_RE = /<\/details>\s*$/i;

/**
 * 这些结构被空行打断后拆开单独渲染会「散架」——列表符号/编号重置、表格只剩表头、
 * 引用断开——所以当同一结构的行之间夹着空行时，把它们并回同一块，不要切开。
 * text 不在其中：段落之间本来就该分成不同气泡。
 */
const MERGEABLE_KINDS = new Set<BlockKind>(['list', 'table', 'quote']);

function classifyLine(line: string): BlockKind {
  if (FENCE_RE.test(line)) return 'fence';
  if (TABLE_RE.test(line)) return 'table';
  if (ORDERED_LIST_RE.test(line) || UNORDERED_LIST_RE.test(line)) return 'list';
  if (QUOTE_RE.test(line)) return 'quote';
  return 'text';
}

/**
 * 把一条助手回复按 markdown 结构拆成几个气泡。
 *
 * 返回 `null` 表示「别拆」——没有内容、或整体只有一个块时都是这样，
 * 调用方据此走原来的单气泡路径。
 */
export function splitAssistantReplyIntoBubbles(content: string): string[] | null {
  const trimmed = content.trim();
  if (!trimmed) return null;

  const lines = trimmed.split('\n');
  const blocks: { kind: BlockKind; lines: string[] }[] = [];
  let current: { kind: BlockKind; lines: string[] } | null = null;
  let inFence = false;
  let inDetails = false;

  const pushCurrent = () => {
    if (current && current.lines.length > 0) {
      blocks.push(current);
    }
    current = null;
  };

  for (const line of lines) {
    if (inDetails) {
      if (!current) current = { kind: 'text', lines: [] };
      current.lines.push(line);
      if (DETAILS_END_RE.test(line)) inDetails = false;
      continue;
    }

    if (DETAILS_START_RE.test(line)) {
      pushCurrent();
      current = { kind: 'text', lines: [line] };
      inDetails = !DETAILS_END_RE.test(line);
      continue;
    }

    if (inFence) {
      // 围栏内部空行是代码的一部分，不能当拆分点。
      current?.lines.push(line);
      if (FENCE_RE.test(line)) inFence = false;
      continue;
    }

    if (FENCE_RE.test(line)) {
      pushCurrent();
      current = { kind: 'fence', lines: [line] };
      inFence = true;
      continue;
    }

    if (line.trim() === '') {
      pushCurrent();
      continue;
    }

    const kind = classifyLine(line);

    // 同一块继续收行。
    if (current && current.kind === kind) {
      current.lines.push(line);
      continue;
    }

    // 要开新块了；若与上一个块是同一种「会散架」的结构（中间只隔了空行），
    // 就并回上一个块，避免把它切开。
    const previous = blocks.length > 0 ? blocks[blocks.length - 1] : null;
    if (previous && previous.kind === kind && MERGEABLE_KINDS.has(kind)) {
      previous.lines.push(line);
      continue;
    }

    pushCurrent();
    current = { kind, lines: [line] };
  }
  pushCurrent();

  const segments = blocks
    .map((block) => block.lines.join('\n').trim())
    .filter((segment) => segment.length > 0);

  // details/summary 是正文末尾的补充信息，跟着上一段走，不单独长成一个气泡。
  const mergedSegments: string[] = [];
  segments.forEach((segment) => {
    const previousIndex = mergedSegments.length - 1;
    if (DETAILS_START_RE.test(segment) && previousIndex >= 0) {
      mergedSegments[previousIndex] = `${mergedSegments[previousIndex]}\n\n${segment}`;
      return;
    }
    mergedSegments.push(segment);
  });

  return mergedSegments.length > 1 ? mergedSegments : null;
}
/**
 * 气泡组末尾那一行时间，`HH:mm`。
 *
 * 只在整组气泡之后出现一次，不跟着每个气泡重复——同一条回复里的气泡本来就
 * 是同一时刻产生的，逐条标时间只会让一屏里堆满重复的 `19:37`。
 */
export function formatMessageClock(timestamp: number): string {
  if (!Number.isFinite(timestamp)) return '';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}


