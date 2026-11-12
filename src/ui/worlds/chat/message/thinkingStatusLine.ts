import type { IconName } from '../../../Icon';
import type { ToolInvocation } from '../../../../types/domain';

export type ThinkingStatusKind = 'thinking' | 'search' | 'reading' | 'tool' | 'code' | 'sandbox' | 'done';

export type ThinkingStatus = {
  kind: ThinkingStatusKind;
  /** 通用工具调用时显示的工具名（`web_fetch(...)` 这种写法）。 */
  toolName?: string;
  /** 正在处理的目标：查询词、网址、文件名。 */
  targetLabel?: string;
};

const SEARCH_TOOL_KINDS = new Set<string>(['webSearch', 'readWebPage']);

const SANDBOX_TOOL_KINDS = new Set<string>(['runCode']);

/** 读文件/读资料：附件、压缩包条目、房间卡、工作区文件、本机文件。 */
const FILE_READ_TOOL_KINDS = new Set<string>([
  'inspectAttachments',
  'readAttachmentText',
  'inspectArchiveEntries',
  'readArchiveEntryText',
  'readCodeCard',
  'readProjectFile',
  'readProjectFileContext',
  'readWorkspaceReference',
  'readWorkspacePreviewState',
  'readDesktopFile',
  'readDesktopFileContext',
  'readMemoryDoc',
  'readPolarisKnowledge'
]);

/**
 * 会被算成「在写代码」的动作：房间卡、工作区文件、以及桌面文件写入。
 * 它们在做的事情对用户是同一件——在敲东西进某个文件。
 */
const CODE_WRITE_TOOL_KINDS = new Set<string>([
  'createCodeCard',
  'patchCodeCard',
  'appendCodeCard',
  'editCodeCardText',
  'createProjectFile',
  'appendProjectFile',
  'insertProjectFile',
  'replaceProjectFileLines',
  'writeProjectFiles',
  'editProjectFileText',
  'patchRoomProject',
  'promoteCardToProject',
  'writeDesktopFile',
  'editDesktopFileText',
  'replaceDesktopFileLines',
  'createDesktopDirectory'
]);

/** 头部图标沿用原来那套 SVG：时钟 / 搜索 / 文件 / 扳手 / 代码 / 闪电。 */
const ICON_BY_KIND: Record<ThinkingStatusKind, IconName> = {
  thinking: 'clock',
  search: 'search',
  reading: 'fileText',
  tool: 'tool',
  code: 'code',
  sandbox: 'zap',
  done: 'clock'
};

export function resolveThinkingStatusIcon(kind: ThinkingStatusKind): IconName {
  return ICON_BY_KIND[kind];
}

/**
 * 把「当前这一轮在干嘛」压成一行状态：调工具时显示工具，没在调就显示在思考。
 *
 * 只在还活着（思考/回复中）的时候给出状态；已经收尾的轮次交给调用方决定要不要
 * 显示「Thought for Ns」。
 */
/** 网址压成 `host/path`，标题或查询词原样返回；状态条只有一行，别让它太长。 */
export function compactThinkingTarget(target: string | undefined) {
  const trimmed = target?.trim();
  if (!trimmed) return undefined;
  if (!/^https?:\/\//i.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    const path = url.pathname.replace(/\/+$/, '');
    return `${url.host}${path}` || url.host;
  } catch {
    return trimmed;
  }
}

export function resolveThinkingStatus(args: {
  runningTool?: Pick<ToolInvocation, 'kind' | 'targetLabel'> | null;
  isActive: boolean;
}): ThinkingStatus | null {
  const tool = args.runningTool ?? null;
  if (tool) {
    const targetLabel = compactThinkingTarget(tool.targetLabel);
    if (SEARCH_TOOL_KINDS.has(tool.kind)) {
      return { kind: 'search', targetLabel };
    }
    if (FILE_READ_TOOL_KINDS.has(tool.kind)) {
      return { kind: 'reading', targetLabel };
    }
    if (SANDBOX_TOOL_KINDS.has(tool.kind)) {
      return { kind: 'sandbox', targetLabel };
    }
    if (CODE_WRITE_TOOL_KINDS.has(tool.kind)) {
      return { kind: 'code', targetLabel };
    }
    return { kind: 'tool', toolName: tool.kind, targetLabel };
  }

  if (args.isActive) {
    return { kind: 'thinking' };
  }
  return null;
}

/** 换一段活动就该重新数秒：思考 → 调工具 → 再思考，各自从头数。 */
export function resolveThinkingStatusSegmentKey(status: ThinkingStatus | null): string {
  if (!status) return 'idle';
  if (status.kind === 'tool') return `tool:${status.toolName ?? ''}:${status.targetLabel ?? ''}`;
  return status.kind;
}
