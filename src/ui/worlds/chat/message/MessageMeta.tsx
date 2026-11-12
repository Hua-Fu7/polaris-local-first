import type { ChatMessage } from '../../../../types/domain';
import { Icon, type IconName } from '../../../Icon';
import { formatTokenCount } from '../chatTokenCount';
import { useI18n } from '../../../../i18n';
import { resolveThinkingStatusIcon, type ThinkingStatus } from './thinkingStatusLine';
import type { ThinkingElapsed } from './useThinkingElapsed';

type MessageMetaProps = {
  message: ChatMessage;
  fallbackAssistantName: string;
  isThinkingActive: boolean;
  onOpenThinkingSummary: (message: ChatMessage) => void;
  /** 就地展开的思考链是否已打开；和 isThinkingActive（正在思考）不是一回事。 */
  isThinkingOpen?: boolean;
  /** 当前轮是否有可展开的思考 / 工具活动。 */
  hasThinkingActivity?: boolean;
  /** 有工具/搜索活动时，Thinking 头部显示的主动作图标。 */
  thinkingActivityIcon?: IconName | null;
  /**
   * 这一轮正在干什么（思考 / 搜索 / 读文件 / 调工具 / 写代码 / 跑沙箱）。
   * 传 null 表示已经收尾，头部会显示「想了 N 秒」。
   */
  thinkingStatus?: ThinkingStatus | null;
  /** 这一轮数出来的秒数（由消息行传进来，省得每个 meta 各起一个计时器）。 */
  thinkingElapsed?: ThinkingElapsed;
  /** 以前的回答存下来的总秒数：App 重启后靠它还原 `Thought for 12s`。 */
  persistedThinkingDurationSeconds?: number | null;
  showIdentity?: boolean;
  showName?: boolean;
  /** 总闸：关掉后模型名与 token 都不显示。 */
  showDetails?: boolean;
  /** 消息头显示模型名。 */
  showModel?: boolean;
  /** 消息头显示 token 用量。 */
  showTokenUsage?: boolean;
  showThinking?: boolean;
  splitIdentityLines?: boolean;
};

export function MessageMeta({
  message,
  fallbackAssistantName,
  isThinkingActive,
  onOpenThinkingSummary,
  isThinkingOpen = false,
  hasThinkingActivity = Boolean(message.thinkingText),
  thinkingActivityIcon = null,
  thinkingStatus = null,
  thinkingElapsed = { segmentSeconds: 0, runSeconds: 0, measured: false, startedAtMs: null },
  persistedThinkingDurationSeconds = null,
  showIdentity = true,
  showName = true,
  showDetails = true,
  showModel = true,
  showTokenUsage = true,
  showThinking = true,
  splitIdentityLines = false
}: MessageMetaProps) {
  const { formatNumber, t } = useI18n();
  const tokenLabel = formatTokenCount(message.tokenCount, message.tokenUsage, {
    formatNumber,
    totalLabel: (count) => t('chat.messageMeta.totalTokens', { count })
  });
  const identityName = message.assistantName || fallbackAssistantName;
  const visibleModel = showDetails && showModel ? message.model : null;
  const visibleTokenLabel = showDetails && showTokenUsage ? tokenLabel : null;
  const showIdentityDetail = Boolean(visibleModel || visibleTokenLabel);
  const showIdentityContent = showIdentity && (showName || showIdentityDetail);
  const identityDetail = (
    <>
      {visibleModel && <span className="message-identity-pill">{visibleModel}</span>}
      {visibleTokenLabel && <span className="message-identity-pill">{visibleTokenLabel}</span>}
    </>
  );
  // 折叠行只显示一行状态：在思考/在调什么工具；只看正文就去就地展开里看。
  const thinkingSegmentKey = thinkingStatus ? `${thinkingStatus.kind}:${thinkingStatus.toolName ?? ''}` : 'idle';
  const compactTarget = (target?: string) => {
    const compact = target?.trim().replace(/\s+/g, ' ');
    if (!compact) return '';
    // 状态条只有一行：长网址/长文件名截断，别把后面的箭头挤出去。
    return compact.length > 44 ? `${compact.slice(0, 44)}…` : compact;
  };
  const withTarget = (base: string, target?: string, separator = ' ') => {
    const short = compactTarget(target);
    return short ? `${base}${separator}${short}` : base;
  };
  const thinkingStatusLabel = (() => {
    if (thinkingStatus) {
      switch (thinkingStatus.kind) {
        case 'thinking':
          return t('chat.thinking.statusThinking', { seconds: thinkingElapsed.segmentSeconds });
        case 'search':
          return withTarget(t('chat.thinking.statusResearching'), thinkingStatus.targetLabel);
        case 'reading':
          return withTarget(t('chat.thinking.statusReading'), thinkingStatus.targetLabel);
        case 'code':
          return withTarget(t('chat.thinking.statusWritingCode'), thinkingStatus.targetLabel, ' · ');
        case 'sandbox':
          return withTarget(t('chat.thinking.statusRunningSandbox'), thinkingStatus.targetLabel, ' · ');
        case 'tool': {
          // 有目标才写括号，别出现 `web_search()` 这种空括号。
          const toolName = thinkingStatus.toolName ?? 'tool';
          const toolTarget = compactTarget(thinkingStatus.targetLabel);
          return toolTarget ? `${toolName}(${toolTarget})` : toolName;
        }
        default:
          break;
      }
    }
    // 收尾：本次数过就用本次的，上次存过的就用存下来的；都没有就不编数字。
    // measured 但秒数还是 0（切后台后定时器没跳）时，用存下来的值，别显示「Thought for 0s」。
    const settledSeconds = thinkingElapsed.measured && thinkingElapsed.runSeconds > 0
      ? thinkingElapsed.runSeconds
      : persistedThinkingDurationSeconds;
    if (settledSeconds !== null) {
      return t('chat.thinking.statusThought', { seconds: settledSeconds });
    }
    return isThinkingActive ? t('chat.messageActions.thinkingLabelActive') : t('chat.messageActions.thinkingLabel');
  })();
  const thinkingIconName = thinkingStatus
    ? resolveThinkingStatusIcon(thinkingStatus.kind)
    : thinkingActivityIcon ?? 'clock';
  const thinkingIconHasActivity = thinkingStatus
    ? thinkingStatus.kind !== 'thinking'
    : Boolean(thinkingActivityIcon);
  const thinkingIconIsSearch = thinkingStatus?.kind === 'search' || thinkingActivityIcon === 'search';

  return (
    <>
      <div className={`message-identity-row ${showIdentityContent ? '' : 'thinking-only'}`.trim()}>
        {showIdentityContent ? (
          <div className={splitIdentityLines ? 'message-identity-stack' : 'message-identity-meta'}>
            {splitIdentityLines && showName ? (
              <>
                <span className="message-identity-name message-identity-name-primary">{identityName}</span>
                {showIdentityDetail ? (
                  <div className="message-identity-meta message-identity-secondary">
                    {identityDetail}
                  </div>
                ) : null}
              </>
            ) : (
              <>
                {showName ? <span className="message-identity-name">{identityName}</span> : null}
                {showIdentityDetail ? identityDetail : null}
              </>
            )}
          </div>
        ) : null}
        {showThinking && hasThinkingActivity ? (
          <button
            type="button"
            className={`thinking-inline-trigger ${isThinkingActive ? 'active' : ''} ${isThinkingOpen ? 'is-open' : ''}`.trim()}
            aria-label={isThinkingActive ? t('chat.messageActions.openThinkingActive') : t('chat.messageActions.openThinking')}
            title={thinkingStatusLabel}
            onClick={() => onOpenThinkingSummary(message)}
          >
            <span className={`thinking-inline-icon ${thinkingIconHasActivity ? 'has-activity' : ''} ${thinkingIconIsSearch ? 'is-search' : ''} ${!thinkingIconHasActivity && isThinkingActive ? 'spinning' : ''}`.trim()} aria-hidden="true">
              <Icon name={thinkingIconName} size={14} />
              {thinkingIconHasActivity ? (
                <span className={`thinking-inline-activity-badge ${isThinkingActive ? 'spinning' : ''}`.trim()}>
                  <Icon name="clock" size={7} />
                </span>
              ) : null}
            </span>
            <span
              key={thinkingStatus ? thinkingSegmentKey : 'idle'}
              className={`thinking-inline-label ${thinkingStatus ? 'is-live' : ''}`.trim()}
            >
              {thinkingStatusLabel}
            </span>
            <span className="thinking-inline-chevron" aria-hidden="true">
              <Icon name="chevron" size={13} />
            </span>
          </button>
        ) : null}
      </div>
    </>
  );
}




