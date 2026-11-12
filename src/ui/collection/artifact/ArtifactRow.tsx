import type { MouseEvent, ReactNode } from 'react';
import { Icon, type IconName } from '../../Icon';

type ArtifactRowProps = {
  /** `index.html` 这种文件名 */
  fileName: string;
  /** 左边那个小图标，默认是 `</>`（代码）；附件用文件图标。 */
  icon?: IconName;
  /** 第二行前半段：`运行入口` / `code` */
  kindLabel: string;
  /** 第二行后半段：`HTML` / `MARKDOWN` */
  language: string;
  active?: boolean;
  spotlight?: boolean;
  pinned?: boolean;
  /** 行尾额外按钮（置顶、删除之类），放在打开箭头前面 */
  trailing?: ReactNode;
  /** 点整行：预览 / 运行 */
  onActivate?: () => void;
  /** 点箭头：打开编辑器 */
  onOpen?: () => void;
  activateLabel?: string;
  openLabel?: string;
};

function stop(event: MouseEvent<HTMLElement>) {
  event.stopPropagation();
}

/**
 * 产物的一行。
 *
 * 左边 `</>`，中间文件名 + `运行入口 · HTML`，右边打开箭头——
 * 取代之前那种带倾斜 `</>` 徽章、外面还套一层圆角卡片的写法。
 */
export function ArtifactRow({
  fileName,
  icon = 'code',
  kindLabel,
  language,
  active = false,
  spotlight = false,
  pinned = false,
  trailing,
  onActivate,
  onOpen,
  activateLabel,
  openLabel
}: ArtifactRowProps) {
  const className = [
    'artifact-row',
    active ? 'is-active' : '',
    spotlight ? 'is-spotlight' : '',
    pinned ? 'is-pinned' : ''
  ].filter(Boolean).join(' ');

  return (
    <div className={className}>
      <button
        type="button"
        className="artifact-row-main"
        onClick={(event) => {
          event.stopPropagation();
          onActivate?.();
        }}
        aria-label={activateLabel ?? fileName}
      >
        <span className="artifact-row-glyph" aria-hidden="true">
          <Icon name={icon} size={15} />
        </span>
        <span className="artifact-row-copy">
          <strong className="artifact-row-name">{fileName}</strong>
          <span className="artifact-row-kind">
            {kindLabel}
            <span className="artifact-row-dot" aria-hidden="true">·</span>
            <span className="artifact-row-language">{language}</span>
          </span>
        </span>
      </button>
      {/* 有没有按钮都占住这块宽度：这样每一行的箭头都落在同一列 */}
      <span className="artifact-row-trailing" onClick={stop} onPointerDown={stop}>
        {trailing}
      </span>
      {onOpen ? (
        <button
          type="button"
          className="artifact-row-open"
          aria-label={openLabel ?? '打开'}
          onClick={(event) => {
            event.stopPropagation();
            onOpen();
          }}
        >
          <Icon name="arrowUpRight" size={15} />
        </button>
      ) : null}
    </div>
  );
}
