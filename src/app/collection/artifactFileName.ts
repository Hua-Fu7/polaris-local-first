import type { CodeCard } from '../../types/domain';

const EXTENSION_BY_LANGUAGE: Record<string, string> = {
  html: 'html',
  htm: 'html',
  markdown: 'md',
  md: 'md',
  javascript: 'js',
  js: 'js',
  typescript: 'ts',
  ts: 'ts',
  tsx: 'tsx',
  jsx: 'jsx',
  css: 'css',
  json: 'json',
  python: 'py',
  py: 'py',
  shell: 'sh',
  bash: 'sh',
  sql: 'sql',
  yaml: 'yml',
  yml: 'yml',
  svg: 'svg',
  text: 'txt',
  txt: 'txt'
};

/** 卡片语言 → 文件后缀。认不出来就当 txt。 */
export function resolveArtifactExtension(language: string | undefined | null) {
  const normalized = (language ?? '').trim().toLowerCase();
  return EXTENSION_BY_LANGUAGE[normalized] ?? (normalized || 'txt');
}

function safeFileStem(title: string) {
  const trimmed = title.trim().replace(/\s+/g, '-');
  const cleaned = trimmed.replace(/[\\/:*?"<>|]/g, '').replace(/^\.+/, '');
  return cleaned || 'artifact';
}

/**
 * 卡片在「文件/产物」列表里显示成什么文件名。
 *
 * 例：标题「测试 1」+ HTML → `测试-1.html`。
 */
export function resolveArtifactFileName(card: Pick<CodeCard, 'title' | 'language'>) {
  const title = card.title?.trim() || '';
  const extension = resolveArtifactExtension(card.language);
  if (!title) return `artifact.${extension}`;
  // 标题里已经带同一后缀就别重复加。
  if (title.toLowerCase().endsWith(`.${extension}`)) return title;
  return `${safeFileStem(title)}.${extension}`;
}

/** 文件名下面那行固定写 `Code · HTML`，跟聊天里那张卡一致。 */
export function resolveArtifactKindLabel() {
  return 'Code';
}
